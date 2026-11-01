// Public web page import. Plain pages are returned as fetched; Xiumi reader pages
// render client-side, so their article HTML is read from the show-data JSON the page embeds.
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
const MAX_PAGE=10*1024*1024;

/** Some origins (OSS-hosted JSON) send pre-compressed bodies regardless of Accept-Encoding. */
export function decodeBody(bytes,encoding,maxBytes) {
  const decode={gzip:gunzipSync,'x-gzip':gunzipSync,deflate:inflateSync,br:brotliDecompressSync}[String(encoding||'').trim().toLowerCase()];
  return decode?decode(bytes,{maxOutputLength:maxBytes}):bytes;
}
const XIUMI_HOST=/(^|\.)(xiumius\.cn|xiumi\.us)$/i;
const escapeHtml=text=>String(text).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/** showInfo that Xiumi injects into reader pages as `injectedData.showInfo = JSON.parse(decodeURIComponent("…"))`. */
export function xiumiShowInfo(page) {
  const match=/injectedData\.showInfo\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]*)"\)\)/.exec(page);
  if(!match)return null;
  try {
    const info=JSON.parse(decodeURIComponent(match[1]));
    return info && typeof info==='object' && typeof info.show_data_url==='string' ? info : null;
  } catch {return null;}
}

/** A standalone document built from Xiumi show data; null when the data carries no preview HTML. */
export function xiumiArticle(data,info={}) {
  const html=data?.$appendix?.htmlForPreview;
  if(typeof html!=='string'||!html.trim())return null;
  const title=typeof data.title==='string'&&data.title.trim()?data.title:typeof info.title==='string'?info.title:'';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`;
}

/** Resolve the show-data URL and reject anything outside Xiumi's own hosts. */
export function xiumiDataUrl(info,pageUrl) {
  let url;
  try {url=new URL(info.show_data_url.startsWith('//')?'https:'+info.show_data_url:info.show_data_url,pageUrl);} catch {return null;}
  return url.protocol==='https:'&&XIUMI_HOST.test(url.hostname)?url.href:null;
}

export async function fetchPublicPage(source,fetchPublic) {
  const page=await fetchPublic(source,{maxBytes:MAX_PAGE,headers:{accept:'text/html,application/json;q=0.9,*/*;q=0.8','user-agent':'Mozilla/5.0 (compatible; Kiumi import)'}});
  const html=page.bytes.toString('utf8');
  const info=xiumiShowInfo(html);
  const dataUrl=info&&xiumiDataUrl(info,page.url);
  if(dataUrl) {
    let data;
    try {data=JSON.parse((await fetchPublic(dataUrl,{maxBytes:MAX_PAGE})).bytes.toString('utf8'));}
    catch(error) {throw new Error(`秀米正文读取失败：${error.message}`);}
    const article=xiumiArticle(data,info);
    if(!article)throw new Error('秀米链接没有可读取的正文，请在秀米里重新生成预览链接。');
    return {html:article,url:source};
  }
  return {html,url:source};
}
