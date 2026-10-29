// kiumi-data: read-only catalog, controlled uploads and WeChat image processing.
// Runs on Node with sharp, reachable through the private data-service boundary.
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile, rename, unlink, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { wechatAction, fetchPublicImage } from './wechat.mjs';

const ROOT = path.resolve(process.env.KIUMI_DATA_DIR ?? '/data');
const KEY = process.env.KIUMI_DATA_KEY ?? '';
const PORT = Number(process.env.KIUMI_DATA_PORT ?? 8080);
let catalogCache;
async function catalogEntries() {
  if(catalogCache && catalogCache.until>Date.now())return catalogCache.entries;
  const legacy=JSON.parse(await readFile(path.join(ROOT,'catalog/index.json'),'utf8'));
  const modern=JSON.parse(await readFile(path.join(ROOT,'catalog/modern-index.json'),'utf8')).map(item=>({...item,room:`modern:${item.room}`}));
  catalogCache={entries:[...legacy,...modern],until:Date.now()+300_000};
  return catalogCache.entries;
}

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

function authorized(req) {
  if (!KEY) return false;
  const header = req.headers['x-data-key'];
  if (header === KEY) return true;
  const auth = req.headers.authorization ?? '';
  return auth === `Bearer ${KEY}`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') return send(res, 200, { ok: true, files: undefined });

  if (!authorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

  if(url.pathname==='/catalog/query' && req.method==='GET') {
    try {
      const room=url.searchParams.get('room'),query=(url.searchParams.get('q')||'').toLowerCase();
      const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
      const entries=await catalogEntries(),seen=new Set();
      const filtered=entries.filter(item=>{
        if(item.room.startsWith('booklet-pg:') || (room&&item.room!==room) || (url.searchParams.get('hasSvg')==='true'&&!item.hasSvg) || (query&&!`${item.displayName} ${item.atomTplId}`.toLowerCase().includes(query)))return false;
        if(seen.has(item.atomTplId))return false;seen.add(item.atomTplId);return true;
      });
      return send(res,200,{ok:true,data:filtered.slice(offset,offset+limit),meta:{total:filtered.length,count:Math.min(limit,Math.max(0,filtered.length-offset))}},{'cache-control':'public, max-age=300'});
    } catch {return send(res,503,{ok:false,error:'catalog unavailable'});}
  }

  if(['/wechat','/import'].includes(url.pathname) && req.method==='POST') {
    try {
      const chunks=[];let size=0;
      for await(const chunk of req) {size+=chunk.length;if(size>5_000_000)return send(res,413,{ok:false,error:'request too large'});chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result=url.pathname==='/import' ? {html:(await fetchPublicImage(input.url)).toString('utf8'),url:input.url} : await wechatAction(input,ROOT);
      return send(res,200,{ok:true,data:result});
    } catch(error) {return send(res,502,{ok:false,error:error.message});}
  }

  // Only these trees are ever exposed.
  let relative;
  try { relative=decodeURIComponent(url.pathname.replace(/^\//,'')); }
  catch {return send(res,400,{ok:false,error:'invalid path'});}
  if (!/^(catalog|assets|uploads)\//.test(relative)) {
    return send(res, 404, { ok: false, error: 'not found' });
  }
  const target = path.resolve(ROOT, relative);
  const tree=path.join(ROOT,relative.split('/')[0]);
  if (!target.startsWith(`${tree}${path.sep}`)) {
    return send(res, 403, { ok: false, error: 'forbidden' });
  }

  if (req.method === 'PUT') {
    if (!/^uploads\/team_[a-f0-9-]+\/img_[a-f0-9-]+\.(png|jpeg|gif|webp)$/.test(relative)) {
      return send(res, 403, { ok: false, error: 'uploads only' });
    }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) return send(res, 413, { ok: false, error: 'too large' });
        chunks.push(chunk);
      }
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, Buffer.concat(chunks), { flag: 'wx' });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => {}); }
      return send(res, 201, { ok: true, bytes: size });
    } catch { return send(res, 500, { ok: false, error: 'write failed' }); }
  }
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { ok: false, error: 'method not allowed' });

  try {
    const info = await stat(target);
    if (!info.isFile()) return send(res, 404, { ok: false, error: 'not found' });
    const ext = path.extname(target).toLowerCase();
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      return res.end();
    }
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': ext === '.json' ? 'public, max-age=60' : 'public, max-age=31536000, immutable',
      etag,
    });
    createReadStream(target).pipe(res);
  } catch {
    send(res, 404, { ok: false, error: 'not found' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`kiumi-data listening on :${PORT} root=${ROOT}`);
});
