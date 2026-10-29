// kiumi-data: read-only HTTP server for the Kiumi catalog and asset mirror.
// No dependencies: runs on node:alpine, binds 0.0.0.0 inside the container and
// is published only to 127.0.0.1 on the host.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(process.env.KIUMI_DATA_DIR ?? '/data');
const KEY = process.env.KIUMI_DATA_KEY ?? '';
const PORT = Number(process.env.KIUMI_DATA_PORT ?? 8080);

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

  // Only these trees are ever exposed.
  const relative = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^(catalog|assets|uploads)\//.test(relative)) {
    return send(res, 404, { ok: false, error: 'not found' });
  }
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) {
    return send(res, 403, { ok: false, error: 'forbidden' });
  }

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
