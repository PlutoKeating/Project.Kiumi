import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import http from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

sharp.cache(false);
sharp.concurrency(1);

const tokens=new Map();
const API='https://api.weixin.qq.com';
const MAX_IMAGE=10*1024*1024;
async function wechatJson(endpoint,options={}) {
  const response=await fetch(API+endpoint,{...options,signal:AbortSignal.timeout(30_000)});
  const payload=await response.json();
  if(!response.ok || payload.errcode) throw new Error(`微信 ${payload.errcode ?? response.status}：${payload.errmsg ?? '请求失败'}`);
  return payload;
}
async function token(appId,secret) {
  const key=createHash('sha256').update(appId+secret).digest('hex'),cached=tokens.get(key);
  if(cached && cached.until>Date.now()+60_000)return cached.value;
  const result=await wechatJson('/cgi-bin/stable_token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:appId,secret,force_refresh:false})});
  if(!result.access_token)throw new Error('微信未返回访问凭证');
  tokens.set(key,{value:result.access_token,until:Date.now()+result.expires_in*1000});
  return result.access_token;
}

function publicAddress(address) {
  if(isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
}
export async function fetchPublicImage(source) {
  let url=new URL(source.startsWith('//')?'https:'+source:source);
  for(let redirects=0;redirects<4;redirects++) {
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('不支持的图片地址');
    const addresses=await lookup(url.hostname,{all:true,family:4});
    if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('不能读取内网图片');
    // Pin the validated address so a second DNS lookup cannot reach private hosts.
    const result=await new Promise((resolve,reject)=>{
      const transport=url.protocol==='https:'?https:http;
      const req=transport.get(url,{family:4,lookup:(_host,_options,callback)=>callback(null,addresses[0].address,4)},res=>{
        if(res.statusCode>=300&&res.statusCode<400){res.resume();resolve({redirect:res.headers.location});return;}
        if(res.statusCode!==200){res.resume();reject(new Error('图片下载失败'));return;}
        let size=0;const chunks=[];
        res.on('data',chunk=>{size+=chunk.length;if(size>MAX_IMAGE){req.destroy(new Error('图片大于 10 MB'));return;}chunks.push(chunk);});
        res.on('error',reject);res.on('end',()=>resolve({bytes:Buffer.concat(chunks)}));
      });
      req.setTimeout(20_000,()=>req.destroy(new Error('图片下载超时')));req.on('error',reject);
    });
    if(result.redirect){url=new URL(result.redirect,url);continue;}
    return result.bytes;
  }
  throw new Error('图片重定向次数过多');
}

async function imageBytes(source,root,assets) {
  if(source.startsWith('data:image/')) {
    const match=/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,(.+)$/s.exec(source);
    if(!match)throw new Error('不支持的内嵌图片');
    const bytes=Buffer.from(match[1],'base64');if(bytes.length>MAX_IMAGE)throw new Error('图片大于 10 MB');return bytes;
  }
  const key=assets?.[source];
  if(key) {
    const file=path.resolve(root,key);
    if(!file.startsWith(path.resolve(root)+path.sep)||! /^(uploads|assets)\//.test(key))throw new Error('图片路径无效');
    return readFile(file);
  }
  return fetchPublicImage(source);
}
async function uploadImage(accessToken,bytes,permanent=false) {
  const form=new FormData();
  // WeChat accepts raster media. Preserve GIF animation; convert SVG/WebP.
  if(!(bytes[0]===137 || bytes[0]===255 || bytes[0]===71))bytes=await sharp(bytes,{limitInputPixels:32_000_000}).resize({width:1920,withoutEnlargement:true}).png().toBuffer();
  const extension=bytes[0]===137?'png':bytes[0]===71?'gif':'jpg';
  form.append('media',new Blob([bytes]),`image.${extension}`);
  return wechatJson(`${permanent?'/cgi-bin/material/add_material':'/cgi-bin/media/uploadimg'}?access_token=${accessToken}${permanent?'&type=image':''}`,{method:'POST',body:form});
}

/** Only reachable through the data service shared-key boundary. */
export async function wechatAction(input,root) {
  const {appId,secret,action}=input;
  if(typeof appId!=='string'||typeof secret!=='string')throw new Error('缺少公众号凭证');
  const accessToken=await token(appId,secret);
  if(action==='check')return {connected:true};
  if(action!=='draft')throw new Error('未知微信操作');
  let html=input.html;
  if(typeof html!=='string'||!input.title)throw new Error('稿件为空');
  const sources=[...new Set([...html.matchAll(/(?:src|xlink:href|href)\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]).filter(v=>v.startsWith('http')||v.startsWith('//')||v.startsWith('/uploads/')||v.startsWith('data:image/')))];
  for(const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi))if(!sources.includes(match[1]))sources.push(match[1]);
  // Only image elements/URLs are rewritten; ordinary article links remain links.
  for(const source of sources) {
    const escaped=source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(!new RegExp(`<(?:img|image)\\b[^>]*(?:src|href|xlink:href)=["']${escaped}["']`,'i').test(html) && !html.includes(`url('${source}')`) && !html.includes(`url("${source}")`) && !html.includes(`url(${source})`))continue;
    const uploaded=await uploadImage(accessToken,await imageBytes(source,root,input.assets));
    if(!uploaded.url)throw new Error('微信图片上传没有返回地址');
    html=html.split(source).join(uploaded.url);
  }
  if(!input.cover)throw new Error('请选择封面图片');
  const cover=await uploadImage(accessToken,await imageBytes(input.cover,root,input.assets),true);
  const article={title:input.title,author:input.author||'',digest:input.digest||'',content:html,thumb_media_id:cover.media_id,need_open_comment:0,only_fans_can_comment:0};
  const draft=await wechatJson(`/cgi-bin/draft/add?access_token=${accessToken}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({articles:[article]})});
  if(!draft.media_id)throw new Error('微信未返回草稿编号');
  // Never repeat draft/add on a readback failure: that would create duplicates.
  try {
    const saved=await wechatJson(`/cgi-bin/draft/get?access_token=${accessToken}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({media_id:draft.media_id})});
    const item=saved.news_item?.[0];
    return {mediaId:draft.media_id,verified:Boolean(item && item.title===input.title),title:item?.title,previewUrl:item?.url ?? null};
  } catch {return {mediaId:draft.media_id,verified:false,previewUrl:null};}
}
