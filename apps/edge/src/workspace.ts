import { currentUser } from './auth.js';
import { dataFetch } from './data.js';
import type { Env } from './index.js';
import { rewriteHtmlAssets, type KiumiDocument } from '@kiumi/core';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status=status; this.code=code; }
}
export const reply = (data: unknown, status = 200) => Response.json({ ok: true, data }, {
  status, headers: { 'cache-control': 'no-store' },
});
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

async function body(request: Request): Promise<Record<string, any>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 4_000_000) throw new ApiError(413, 'TOO_LARGE', '文稿过大');
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new ApiError(400, 'INVALID_BODY', '请求格式不正确'); }
}
function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new ApiError(400, 'INVALID_BODY', '请输入 1–200 字的名称');
  return value.trim();
}
export async function teamContext(env: Env, request: Request) {
  const user = await currentUser(request, env);
  if (!user) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录');
  const teamId = request.headers.get('x-team-id') ?? new URL(request.url).searchParams.get('team');
  if (!teamId) throw new ApiError(409, 'TEAM_REQUIRED', '请先创建或选择团队');
  const member = await env.DB.prepare('SELECT role FROM members WHERE team_id = ? AND user_sub = ?').bind(teamId, user.sub).first<{role: string}>();
  if (!member) throw new ApiError(403, 'TEAM_FORBIDDEN', '你不是该团队的成员');
  return { user, teamId, role: member.role };
}
function owner(role: string) {
  if (role !== 'owner') throw new ApiError(403, 'OWNER_REQUIRED', '只有团队创建者可以管理成员与公众号');
}
function documentFrom(row: any): KiumiDocument {
  return { version: 1, id: row.id, title: row.title, blocks: JSON.parse(row.blocks),
    meta: { createdAt: row.updated_at, ...JSON.parse(row.meta || '{}'), updatedAt: row.updated_at } };
}
function blocks(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 500 || value.some(b => !b || !['native','library'].includes(b.kind) || typeof b.id !== 'string' || (b.kind === 'native' && !b.node))) {
    throw new ApiError(400, 'INVALID_DOCUMENT', '文稿块格式不正确，最多 500 块');
  }
  return value;
}

export async function workspaceRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!/^\/api\/(teams|documents|uploads|assets\/upload)(\/|$)/.test(path)) return null;
  const user = await currentUser(request, env);
  if (!user) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录');

  if (path === '/api/teams' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT t.id,t.name,m.role FROM teams t JOIN members m ON m.team_id=t.id WHERE m.user_sub=? ORDER BY t.created_at').bind(user.sub).all();
    return reply(rows.results);
  }
  if (path === '/api/teams' && method === 'POST') {
    const name = title((await body(request)).name), teamId = id('team');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO teams VALUES (?,?,?,?)').bind(teamId,name,user.sub,now()),
      env.DB.prepare('INSERT INTO members VALUES (?,?,?,?)').bind(teamId,user.sub,user.name || user.email || '团队创建者','owner'),
      // Preserve existing personal drafts when their owner creates their first team.
      env.DB.prepare('UPDATE documents SET team_id=? WHERE owner_sub=? AND team_id IS NULL').bind(teamId,user.sub),
    ]);
    return reply({id:teamId,name,role:'owner'},201);
  }
  if (path === '/api/teams/join' && method === 'POST') {
    const { code } = await body(request);
    if (typeof code !== 'string') throw new ApiError(400,'INVALID_BODY','请输入邀请码');
    const invite = await env.DB.prepare('SELECT team_id FROM invites WHERE code=? AND expires_at>?').bind(code.trim(),now()).first<{team_id:string}>();
    if (!invite) throw new ApiError(404,'INVITE_NOT_FOUND','邀请码不存在或已过期');
    await env.DB.prepare('INSERT OR IGNORE INTO members VALUES (?,?,?,?)').bind(invite.team_id,user.sub,user.name || user.email || '成员','member').run();
    return reply({id:invite.team_id});
  }
  const context = await teamContext(env,request);
  const {teamId,role} = context;
  if (path === '/api/teams/members' && method === 'GET') {
    return reply((await env.DB.prepare('SELECT user_sub AS id,name,role FROM members WHERE team_id=?').bind(teamId).all()).results);
  }
  if (path === '/api/teams/invite' && method === 'POST') {
    owner(role);
    const code = crypto.randomUUID().replace(/-/g,''), expiresAt = new Date(Date.now()+7*86400_000).toISOString();
    await env.DB.batch([env.DB.prepare('DELETE FROM invites WHERE team_id=?').bind(teamId), env.DB.prepare('INSERT INTO invites VALUES (?,?,?)').bind(code,teamId,expiresAt)]);
    return reply({code,expiresAt});
  }
  if (path === '/api/teams/members' && method === 'DELETE') {
    owner(role); const target = (await body(request)).userId;
    if (target === user.sub) throw new ApiError(400,'OWNER_REQUIRED','不能移除团队创建者');
    await env.DB.prepare("DELETE FROM members WHERE team_id=? AND user_sub=? AND role != 'owner'").bind(teamId,target).run();
    return reply({deleted:true});
  }
  if (path === '/api/documents') {
    if (method === 'GET') return reply((await env.DB.prepare('SELECT id,title,updated_at AS updatedAt FROM documents WHERE team_id=? ORDER BY updated_at DESC').bind(teamId).all()).results);
    if (method === 'POST') {
      const input=await body(request), documentId=id('doc'), stamp=now();
      const doc={version:1,id:documentId,title:title(input.title),blocks:blocks(input.blocks ?? []),meta:{...input.meta,createdAt:stamp,updatedAt:stamp}};
      await env.DB.prepare('INSERT INTO documents(id,title,blocks,updated_at,owner_sub,team_id,meta) VALUES (?,?,?,?,?,?,?)').bind(documentId,doc.title,JSON.stringify(doc.blocks),stamp,user.sub,teamId,JSON.stringify(doc.meta)).run();
      return reply(doc,201);
    }
  }
  if (path.startsWith('/api/documents/')) {
    const documentId=decodeURIComponent(path.slice('/api/documents/'.length));
    const row=await env.DB.prepare('SELECT * FROM documents WHERE id=? AND team_id=?').bind(documentId,teamId).first<any>();
    if (!row) throw new ApiError(404,'DOCUMENT_NOT_FOUND','文稿不存在');
    if (method === 'GET') return reply(documentFrom(row));
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM documents WHERE id=? AND team_id=?').bind(documentId,teamId).run();
      return reply({deleted:true});
    }
    if (method === 'PATCH') {
      const patch=await body(request), stamp=now();
      const next={...row,title:patch.title === undefined ? row.title : title(patch.title),blocks:patch.blocks === undefined ? row.blocks : JSON.stringify(blocks(patch.blocks)),meta:JSON.stringify({...JSON.parse(row.meta),...patch.meta}),updated_at:stamp};
      await env.DB.prepare('UPDATE documents SET title=?,blocks=?,meta=?,updated_at=? WHERE id=? AND team_id=?').bind(next.title,next.blocks,next.meta,stamp,documentId,teamId).run();
      return reply(documentFrom(next));
    }
  }
  if (path === '/api/uploads' && method === 'GET') {
    const rows=await env.DB.prepare('SELECT id,name,bytes,created_at FROM uploads WHERE team_id=? ORDER BY created_at DESC').bind(teamId).all<any>();
    return reply(rows.results.map(r=>({...r,mtime:Date.parse(r.created_at),url:`/uploads/${r.id}`})));
  }
  if (path === '/api/assets/upload' && method === 'POST') {
    const form=await request.formData(), file=form.get('file');
    if (!(file instanceof File)) throw new ApiError(400,'INVALID_BODY','请选择图片');
    if (file.size > 10*1024*1024 || !file.size) throw new ApiError(413,'UPLOAD_SIZE','图片需在 10 MB 以内');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const mime=bytes[0]===137 && bytes[1]===80 ? 'image/png' : bytes[0]===255 && bytes[1]===216 ? 'image/jpeg' : new TextDecoder().decode(bytes.slice(0,3))==='GIF' ? 'image/gif' : new TextDecoder().decode(bytes.slice(8,12))==='WEBP' ? 'image/webp' : '';
    if (!mime) throw new ApiError(400,'UPLOAD_TYPE','请使用 PNG、JPEG、GIF 或 WebP 图片');
    const uploadId=id('img'), key=`uploads/${teamId}/${uploadId}.${mime.split('/')[1]}`;
    const upstream=await dataFetch(env,key,{method:'PUT',body:bytes,headers:{'content-type':mime}});
    if (!upstream.ok) throw new ApiError(502,'UPLOAD_FAILED','图片保存失败，请重试');
    await env.DB.prepare('INSERT INTO uploads VALUES (?,?,?,?,?,?,?)').bind(uploadId,teamId,file.name.slice(0,200),key,mime,bytes.length,now()).run();
    return reply({id:uploadId,sha256:uploadId,bytes:bytes.length,url:`/uploads/${uploadId}`},201);
  }
  throw new ApiError(405,'METHOD_NOT_ALLOWED','不支持的操作');
}

/** Upload URLs are private; external exports receive separately signed URLs. */
export async function privateUpload(request: Request, env: Env): Promise<Response> {
  const uploadId=new URL(request.url).pathname.slice('/uploads/'.length);
  const row=await env.DB.prepare('SELECT * FROM uploads WHERE id=?').bind(uploadId).first<any>();
  if (!row) throw new ApiError(404,'NOT_FOUND','图片不存在');
  const user=await currentUser(request,env);
  const member=user && await env.DB.prepare('SELECT 1 FROM members WHERE team_id=? AND user_sub=?').bind(row.team_id,user.sub).first();
  const token=new URL(request.url).searchParams.get('share');
  const shared=token && token === await uploadShare(env,uploadId);
  if (!member && !shared) throw new ApiError(403,'TEAM_FORBIDDEN','图片仅团队成员可访问');
  const response=await dataFetch(env,row.storage_key);
  return new Response(response.body,{status:response.status,headers:{'content-type':row.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}

async function uploadShare(env: Env, uploadId: string): Promise<string> {
  if(!env.KIUMI_DATA_KEY) throw new Error('missing signing key');
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.KIUMI_DATA_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`image-export:${uploadId}`)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

export async function exportImages(html:string,request:Request,env:Env):Promise<string> {
  const ids=[...new Set([...html.matchAll(/\/uploads\/(img_[a-f0-9-]+)/g)].map(m=>m[1]!))];
  if(!ids.length)return html;
  const user=await currentUser(request,env);
  if(!user)throw new ApiError(401,'LOGIN_REQUIRED','请登录后导出团队图片');
  const replacements=new Map<string,string>();
  for(const uploadId of ids) {
    const row=await env.DB.prepare('SELECT u.id FROM uploads u JOIN members m ON m.team_id=u.team_id WHERE u.id=? AND m.user_sub=?').bind(uploadId,user.sub).first();
    if(!row)throw new ApiError(403,'TEAM_FORBIDDEN','不能导出其他团队的图片');
    const from=`/uploads/${uploadId}`,to=`${new URL(request.url).origin}${from}?share=${await uploadShare(env,uploadId)}`;
    replacements.set(from,to);
  }
  return rewriteHtmlAssets(html,source=>{
    try {const url=new URL(source,new URL(request.url).origin);return url.origin===new URL(request.url).origin?(replacements.get(url.pathname)??source):source;}catch{return source;}
  });
}
