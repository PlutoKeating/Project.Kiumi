import { sanitizeHtml, type KiumiDocument } from '@kiumi/core';
import type { Env } from './index.js';
import { ApiError, reply, teamContext } from './workspace.js';
import { dataFetch } from './data.js';

const encoder=new TextEncoder();
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=(s:string)=>Uint8Array.from(s.match(/.{2}/g)??[],v=>parseInt(v,16));
async function credentialKey(env:Env) {
  if(!env.KIUMI_DATA_KEY)throw new Error('missing credential key');
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(`wechat-credentials:${env.KIUMI_DATA_KEY}`));
  return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
async function encrypt(env:Env,secret:string,scope:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(scope)},await credentialKey(env),encoder.encode(secret));
  return `${hex(iv)}.${hex(new Uint8Array(bytes))}`;
}
async function decrypt(env:Env,secret:string,scope:string) {
  const [iv,data]=secret.split('.');
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(iv!),additionalData:encoder.encode(scope)},await credentialKey(env),unhex(data!));
  return new TextDecoder().decode(bytes);
}
async function broker(env:Env,input:unknown) {
  const response=await dataFetch(env,'wechat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(180_000)});
  const payload=await response.json() as {ok:boolean;data:any;error?:string};
  if(!response.ok||!payload.ok)throw new ApiError(502,'WECHAT_API_ERROR',payload.error??'公众号服务暂时不可用');
  return payload.data;
}

export async function wechatRoutes(request:Request,env:Env,render:(doc:KiumiDocument)=>Promise<string>):Promise<Response|null> {
  const path=new URL(request.url).pathname,method=request.method;
  if(!path.startsWith('/api/wechat/')&&!path.startsWith('/api/accounts'))return null;
  const {teamId,role}=await teamContext(env,request);
  if(path==='/api/accounts' && method==='GET') {
    return reply((await env.DB.prepare('SELECT id,name,app_id AS appId FROM wechat_accounts WHERE team_id=? ORDER BY created_at').bind(teamId).all()).results);
  }
  if(path==='/api/accounts' && method==='POST') {
    if(role!=='owner')throw new ApiError(403,'OWNER_REQUIRED','只有团队创建者可以绑定公众号');
    const input=await request.json() as {name?:string;appId?:string;secret?:string};
    if(!input.name?.trim()||!/^wx[a-zA-Z0-9]{10,30}$/.test(input.appId??'')||!input.secret||input.secret.length>200)throw new ApiError(400,'INVALID_BODY','请填写公众号名称、AppID 和 AppSecret');
    await broker(env,{action:'check',appId:input.appId,secret:input.secret});
    const accountId=`account_${crypto.randomUUID()}`;
    const secret=await encrypt(env,input.secret,`${teamId}:${input.appId}`);
    await env.DB.prepare('INSERT INTO wechat_accounts VALUES (?,?,?,?,?,?) ON CONFLICT(team_id,app_id) DO UPDATE SET name=excluded.name,secret=excluded.secret').bind(accountId,teamId,input.name.trim().slice(0,100),input.appId,secret,new Date().toISOString()).run();
    return reply({connected:true});
  }
  if(path.startsWith('/api/accounts/')&&method==='DELETE') {
    if(role!=='owner')throw new ApiError(403,'OWNER_REQUIRED','只有团队创建者可以移除公众号');
    await env.DB.prepare('DELETE FROM wechat_accounts WHERE id=? AND team_id=?').bind(path.slice('/api/accounts/'.length),teamId).run();
    return reply({deleted:true});
  }
  if(path==='/api/wechat/config') {
    const count=await env.DB.prepare('SELECT count(*) AS n FROM wechat_accounts WHERE team_id=?').bind(teamId).first<{n:number}>();
    return reply({configured:Boolean(count?.n)});
  }
  if(path==='/api/wechat/draft'&&method==='POST') {
    const input=await request.json() as {documentId?:string;accountId?:string;cover?:string;requestId?:string};
    if(!input.documentId||!input.accountId||!input.cover||!input.requestId||input.requestId.length>100)throw new ApiError(400,'INVALID_BODY','请选择文稿、公众号和封面');
    const account=await env.DB.prepare('SELECT * FROM wechat_accounts WHERE id=? AND team_id=?').bind(input.accountId,teamId).first<any>();
    const row=await env.DB.prepare('SELECT * FROM documents WHERE id=? AND team_id=?').bind(input.documentId,teamId).first<any>();
    if(!account||!row)throw new ApiError(404,'NOT_FOUND','公众号或文稿不属于当前团队');
    const jobId=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`${teamId}:${input.requestId}`))));
    const existing=await env.DB.prepare('SELECT status,result FROM draft_jobs WHERE id=?').bind(jobId).first<any>();
    if(existing?.status==='done')return reply(JSON.parse(existing.result));
    if(existing)throw new ApiError(409,'DRAFT_PENDING','此提交已处理或仍在处理中，请先查看公众号草稿箱，避免重复提交');
    const inserted=await env.DB.prepare("INSERT OR IGNORE INTO draft_jobs VALUES (?,?,?,?, 'processing',NULL,?)").bind(jobId,teamId,input.accountId,input.documentId,new Date().toISOString()).run();
    if(!inserted.meta.changes)throw new ApiError(409,'DRAFT_PENDING','草稿正在提交');
    try {
      const meta=JSON.parse(row.meta||'{}');
      const doc={version:1,id:row.id,title:row.title,blocks:JSON.parse(row.blocks),meta} as KiumiDocument;
      const html=sanitizeHtml(await render(doc));
      const uploads=await env.DB.prepare('SELECT id,storage_key FROM uploads WHERE team_id=?').bind(teamId).all<any>();
      const assets:Record<string,string>={};
      for(const upload of uploads.results)assets[`/uploads/${upload.id}`]=upload.storage_key;
      // Resolve source catalog URLs to local mirror paths without exposing the data key.
      const manifestResponse=await dataFetch(env,'catalog/assets-manifest.json');
      if(manifestResponse.ok) {
        const manifest=await manifestResponse.json() as Record<string,{path:string}>;
        for(const [url,item] of Object.entries(manifest)) {if(html.includes(url)||input.cover===url) assets[url]=`assets/${item.path}`;const relative=url.replace(/^https:/,'');if(html.includes(relative))assets[relative]=`assets/${item.path}`;}
      }
      if(input.cover.startsWith('/uploads/')&&!assets[input.cover])throw new ApiError(403,'TEAM_FORBIDDEN','封面不属于当前团队');
      for(const match of html.matchAll(/\/uploads\/(img_[a-f0-9-]+)/g))if(!assets[match[0]])throw new ApiError(403,'TEAM_FORBIDDEN','正文含有其他团队的图片');
      const result=await broker(env,{action:'draft',appId:account.app_id,secret:await decrypt(env,account.secret,`${teamId}:${account.app_id}`),title:row.title,author:meta.author,digest:meta.digest,html,cover:input.cover,assets});
      await env.DB.prepare("UPDATE draft_jobs SET status='done',result=? WHERE id=?").bind(JSON.stringify(result),jobId).run();
      return reply(result);
    } catch(error) {
      await env.DB.prepare("UPDATE draft_jobs SET status='failed' WHERE id=?").bind(jobId).run();
      throw error;
    }
  }
  throw new ApiError(404,'NOT_FOUND','接口不存在');
}
