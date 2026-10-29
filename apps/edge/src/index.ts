import {
  fillMatrix,
  sanitizeHtml,
  rewriteHtmlAssets,
  normalizeMatrix,
  renderDocument,
  validateHtml,
  type KiumiDocument,
  type TemplateRecord,
} from '@kiumi/core';
import { currentUser, handleAuth } from './auth.js';
import { workspaceRoutes, privateUpload, exportImages, ApiError, teamContext } from './workspace.js';
import { wechatRoutes } from './wechat.js';
import { dataFetch } from './data.js';

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DATA?: R2Bucket;
  DB: D1Database;
  KIUMI_STRICT_ASSETS?: string;
  /** Origin of the Shenzhen ECS data service, e.g. https://data.kiumi.example */
  KIUMI_DATA_ORIGIN?: string;
  /** Workers VPC service binding: reaches the data service over the tunnel. */
  KIUMI_DATA?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
  KIUMI_DATA_KEY?: string;
  ID_ISSUER_URL?: string;
  ID_CLIENT_ID?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  WECHAT_DEFAULT_THUMB_MEDIA_ID?: string;
}

const json = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });

const fail = (code: string, message: string, status = 400): Response =>
  new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  json: 'application/json',
};

function mimeOf(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

const slug = (id: string): string => id.replace(/[^a-zA-Z0-9._-]+/g, '__');

/** Fetch one object from the ECS data service (the primary store). */
async function fetchFromEcs(env: Env, key: string): Promise<Response | null> {
  const response = await dataFetch(env, key);
  return response.ok ? response : null;
}

const CACHE_TTL = 300;

/** R2 stays supported, but the ECS mirror is the source of truth. */
async function readObject(env: Env, key: string): Promise<Response | null> {
  // Catalog JSON is large and changes rarely: keep a colo copy so a cold tunnel
  // round trip is paid once, not per request.
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://kiumi.internal/objects/${key}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const fromEcs = await fetchFromEcs(env, key);
  if (fromEcs) {
    const copy = new Response(fromEcs.body, { status: 200, headers: fromEcs.headers });
    copy.headers.set('cache-control', `public, max-age=${CACHE_TTL}`);
    await cache.put(cacheKey, copy.clone());
    return copy;
  }
  if (!env.DATA) return null;
  const object = await env.DATA.get(key);
  if (!object) return null;
  return new Response(object.body, { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const response = await readObject(env, key);
  if (!response) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface IndexEntry {
  atomTplId: string;
  displayName: string;
  room: string;
  accessibility: string;
  hasSvg: boolean;
  hasAnimation: boolean;
  byteSize: number;
  updatedAt?: string;
}

async function loadIndex(env: Env): Promise<IndexEntry[]> {
  return (await readJson<IndexEntry[]>(env, 'catalog/index.json')) ?? [];
}

async function loadModern(env: Env): Promise<IndexEntry[]> {
  const entries = (await readJson<IndexEntry[]>(env, 'catalog/modern-index.json')) ?? [];
  return entries.map((entry) => ({ ...entry, room: `modern:${entry.room}` }));
}

async function getRecord(env: Env, atomTplId: string): Promise<TemplateRecord | null> {
  const file = `${slug(atomTplId)}.json`;
  for (const prefix of ['catalog/templates', 'catalog/svg-anim', 'catalog/modern']) {
    const record = await readJson<TemplateRecord>(env, `${prefix}/${file}`);
    if (record) return record;
  }
  return null;
}

async function skeletons(env: Env): Promise<Record<string, string>> {
  return (await readJson<Record<string, string>>(env, 'catalog/pack.json')) ?? {};
}

async function manifest(env: Env): Promise<Record<string, { path: string }>> {
  return (await readJson<Record<string, { path: string }>>(env, 'catalog/assets-manifest.json')) ?? {};
}

// ---------------------------------------------------------------------------
// WeChat
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/health') return json({ ok: true, runtime: 'worker' });
      if (path === '/api/me') {
        const user = await currentUser(request, env);
        return json({ user, loginEnabled: Boolean(env.ID_ISSUER_URL && env.ID_CLIENT_ID) });
      }
      if (path.startsWith('/auth/')) {
        const handled = await handleAuth(request, env);
        if (handled) return handled;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return fail('FORBIDDEN', '不允许跨站写入', 403);
      }
      if(path === '/api/import/url' && request.method === 'POST') {
        await teamContext(env,request);
        const input=await request.json() as {url?:string};
        if(typeof input.url!=='string' || !/^https?:\/\//.test(input.url))return fail('INVALID_BODY','请输入网页地址');
        const response=await dataFetch(env,'import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
        return new Response(response.body,{status:response.status,headers:{'content-type':'application/json'}});
      }
      const wechat = await wechatRoutes(request, env, async doc => {
        const rendered = await render(env, new Request(request.url, {method:'POST',headers:request.headers,body:JSON.stringify({document:doc,localAssets:false,forWechat:true})}));
        const payload = await rendered.json() as {data?:{html:string};error?:{message:string}};
        if(!payload.data)throw new Error(payload.error?.message ?? '渲染失败');
        return payload.data.html;
      });
      if(wechat)return wechat;
      const workspace = await workspaceRoutes(request, env);
      if (workspace) return workspace;
      if (path.startsWith('/uploads/')) return await privateUpload(request, env);
      if (path === '/api/rooms') return rooms(env);
      if (path === '/api/templates') return templates(env, url);
      if (path === '/api/template') return template(env, url);
      if (path === '/api/template/preview') return preview(env, url);
      if (path === '/api/slots') return slots(env, url);
      if (path === '/api/search') return search(env, url);
      if (path === '/api/render' && request.method === 'POST') return render(env, request);
      if (path === '/api/validate' && request.method === 'POST') return validate(request);
      if (path === '/api/fill' && request.method === 'POST') return fill(env, request);
      if (path === '/api/assets') return assetsList(env, url);
      if (path === '/api/assets/coverage') return coverage(env);
      if (path.startsWith('/assets/')) return serveR2(env, `assets/${path.slice('/assets/'.length)}`);
      if (path === '/assets/__missing.svg') return missingPlaceholder();

      if (path.startsWith('/api/')) return fail('NOT_FOUND', '接口不存在', 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.code, error.message, error.status);
      console.error('request failed', path, (error as Error).message);
      return fail('INTERNAL_ERROR', '服务暂时不可用，请稍后重试', 500);
    }
  },
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

async function rooms(env: Env): Promise<Response> {
  const legacy = (await readJson<{ tag: string; name: string; order: number; house: string; floor: string; count: number }[]>(
    env,
    'catalog/rooms.json',
  )) ?? [];

  // The tunnel is the slow path: prefer the pre-counted groups, and only walk
  // the full modern index when that file is missing.
  const counts = await readJson<{ group: string; count: number }[]>(env, 'catalog/modern-rooms.json');
  let modernRooms: { tag: string; name: string; order: number; house: string; floor: string; count: number }[];
  if (counts) {
    modernRooms = counts.map(({ group, count }, index) => ({
      tag: `modern:${group}`,
      name: group,
      order: 900 + index,
      house: 'paper',
      floor: 'modern',
      count,
    }));
  } else {
    const modern = await loadModern(env);
    const groups = new Map<string, number>();
    for (const entry of modern) {
      const group = entry.room.replace(/^modern:/, '');
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }
    modernRooms = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, count], index) => ({
        tag: `modern:${group}`,
        name: group,
        order: 900 + index,
        house: 'paper',
        floor: 'modern',
        count,
      }));
  }
  return json([...legacy, ...modernRooms]);
}

async function templates(env: Env, url: URL): Promise<Response> {
  const room = url.searchParams.get('room') ?? undefined;
  const q = url.searchParams.get('q')?.toLowerCase();
  const hasSvg = url.searchParams.get('hasSvg');
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);

  const pool = room?.startsWith('modern:') ? await loadModern(env) : await loadIndex(env);
  const filtered = pool.filter((entry) => {
    if (room && entry.room !== room) return false;
    if (hasSvg === 'true' && !entry.hasSvg) return false;
    if (q && !`${entry.displayName} ${entry.atomTplId}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return new Response(
    JSON.stringify({
      ok: true,
      data: filtered.slice(offset, offset + limit),
      meta: { total: filtered.length, count: Math.min(limit, filtered.length) },
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

async function template(env: Env, url: URL): Promise<Response> {
  const id = url.searchParams.get('id');
  if (!id) return fail('INVALID_BODY', 'missing ?id=');
  const record = await getRecord(env, id);
  if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${id}`, 404);
  return json(record);
}

// Template markup relies on the upstream stylesheet; reproduce the parts that
// matter for a readable card and a faithful preview body.
const PREVIEW_STYLE = `<style>
*{box-sizing:border-box}
html,body{margin:0;padding:6px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;color:#3f3f3f;background:#fff}
img{max-width:100%;height:auto}
svg{max-width:100%;height:auto}
section,div,p{max-width:100%}
p{margin:0}
</style>`;

async function preview(env: Env, url: URL): Promise<Response> {
  const id = url.searchParams.get('id');
  if (!id) return fail('INVALID_BODY', 'missing ?id=');
  const record = await getRecord(env, id);
  if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${id}`, 404);
  const body = localizeAssets(sanitizeHtml(record.html), await manifest(env));
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${PREVIEW_STYLE}</head><body>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } },
  );
}

async function slots(env: Env, url: URL): Promise<Response> {
  const id = url.searchParams.get('id');
  if (!id) return fail('INVALID_BODY', 'missing ?id=');
  const record = await getRecord(env, id);
  if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${id}`, 404);
  const comp = normalizeMatrix(record.matrix)[0];
  return json(comp ? Object.keys(comp.slots) : []);
}

async function search(env: Env, url: URL): Promise<Response> {
  const q = url.searchParams.get('q')?.trim();
  if (!q) return fail('INVALID_BODY', 'missing ?q=');
  const pool = [...(await loadIndex(env)), ...(await loadModern(env))];
  const needle = q.toLowerCase();
  return json(
    pool.filter((entry) => `${entry.displayName} ${entry.atomTplId}`.toLowerCase().includes(needle)).slice(0, 20),
  );
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function localizeAssets(html: string, map: Record<string, { path: string }>, origin='', forWechat=false): string {
  return rewriteHtmlAssets(html,raw=>{
    const normalized=raw.startsWith('//')?`https:${raw}`:raw.replace(/^http:\/\//,'https://');
    const entry=map[normalized];
    if(entry)return forWechat?normalized:`${origin}/assets/${entry.path}`;
    if(/^https?:\/\/[^/]*(?:xiumi\.us|xiumius\.cn)\//i.test(normalized))return null;
    return raw;
  });
}

async function render(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as {
    document?: KiumiDocument;
    tplId?: string;
    matrix?: unknown;
    set?: Record<string, string>;
    localAssets?: boolean;
    forWechat?: boolean;
  };
  const skeletonsMap = await skeletons(env);
  const map = await manifest(env);

  let html: string;
  let warnings: unknown[] = [];

  if (body.document) {
    const recorded = new Map<string,string>();
    await Promise.all(body.document.blocks.filter(b => b.kind === 'library' && !b.html).map(async b => {
      if (b.kind !== 'library') return;
      const record = await getRecord(env,b.tplId);
      if (record && JSON.stringify(record.matrix) === JSON.stringify(b.matrix)) recorded.set(b.tplId,record.html);
    }));
    const result = renderDocument(body.document, skeletonsMap, { recordedHtml: id => recorded.get(id) });
    html = result.html;
    warnings = result.warnings;
  } else if (body.tplId) {
    const record = await getRecord(env, body.tplId);
    if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${body.tplId}`, 404);
    const matrix = body.set ? fillMatrix(record.matrix, body.set) : record.matrix;
    // Recorded markup is a byte-faithful copy of the original, so it cannot
    // carry edits: once someone overrides a slot, render from the matrix.
    const recordedHtml = body.set ? undefined : record.html;
    const result = renderDocument(
      {
        version: 1,
        id: 'tmp',
        title: '',
        blocks: [{ kind: 'library', id: 'b', tplId: record.atomTplId, matrix }],
        meta: { createdAt: '', updatedAt: '' },
      },
      skeletonsMap,
      { recordedHtml: (tplId) => (tplId === record.atomTplId ? recordedHtml : undefined) },
    );
    html = result.html;
    warnings = result.warnings;
  } else if (body.matrix !== undefined) {
    const result = renderDocument(
      {
        version: 1,
        id: 'tmp',
        title: '',
        blocks: [{ kind: 'library', id: 'b', tplId: '', matrix: body.matrix }],
        meta: { createdAt: '', updatedAt: '' },
      },
      skeletonsMap,
    );
    html = result.html;
    warnings = result.warnings;
  } else {
    return fail('INVALID_BODY', 'provide document, tplId or matrix');
  }

  html = localizeAssets(html, map, body.localAssets ? '' : new URL(request.url).origin, body.forWechat);
  if (!body.localAssets && !body.forWechat) html = await exportImages(html, request, env);
  return json({ html, bytes: html.length, warnings, issues: validateHtml(html) });
}

async function validate(request: Request): Promise<Response> {
  const { html, maxBytes } = (await request.json()) as { html?: string; maxBytes?: number };
  if (typeof html !== 'string') return fail('INVALID_BODY', 'html is required');
  return json({ bytes: html.length, issues: validateHtml(html, { maxBytes }) });
}

async function fill(env: Env, request: Request): Promise<Response> {
  const { tplId, set } = (await request.json()) as { tplId?: string; set?: Record<string, string> };
  if (!tplId) return fail('INVALID_BODY', 'tplId is required');
  const record = await getRecord(env, tplId);
  if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${tplId}`, 404);
  return render(env, new Request(request.url, {
    method: 'POST',
    body: JSON.stringify({ tplId, set }),
    headers: { 'content-type': 'application/json' },
  }));
}

// ---------------------------------------------------------------------------
// Documents (D1)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

async function assetsList(env: Env, url: URL): Promise<Response> {
  const q = url.searchParams.get('q')?.toLowerCase();
  const limit = Number(url.searchParams.get('limit') ?? 60);
  const entries = Object.entries(await manifest(env))
    .filter(([key]) => !q || key.toLowerCase().includes(q))
    .slice(0, limit)
    .map(([remote, entry]) => ({ url: remote, path: entry.path }));
  return json(entries);
}

async function coverage(env: Env): Promise<Response> {
  const strict = env.KIUMI_STRICT_ASSETS !== '0';
  // Pre-computed counters keep this off the tunnel; the manifest is megabytes.
  const precomputed = await readJson<{ referenced: number; mirrored: number; gone: number; coverage: number }>(
    env,
    'catalog/assets-coverage.json',
  );
  if (precomputed) return json({ ...precomputed, strict });

  const required = (await readJson<string[]>(env, 'catalog/assets-required.json')) ?? [];
  const map = await manifest(env);
  const probed = await readJson<{ urls?: string[] }>(env, 'catalog/assets-missing.json');
  const gone = new Set(probed?.urls ?? []);
  const mirrored = required.filter((remote) => map[remote]).length;
  const goneCount = required.filter((remote) => !map[remote] && gone.has(remote)).length;
  const reachable = required.length - goneCount;
  return json({
    referenced: required.length,
    mirrored,
    /** Upstream no longer serves these; a local copy cannot exist. */
    gone: goneCount,
    coverage: reachable ? Number((mirrored / reachable).toFixed(4)) : 1,
    strict,
  });
}

async function serveR2(env: Env, key: string): Promise<Response> {
  const upstream = await fetchFromEcs(env, key);
  if (upstream) {
    return new Response(upstream.body, {
      headers: {
        'content-type': upstream.headers.get('content-type') ?? mimeOf(key),
        'cache-control': 'public, max-age=31536000, immutable',
        etag: upstream.headers.get('etag') ?? '',
      },
    });
  }
  if (!env.DATA) return missingPlaceholder();
  const object = await env.DATA.get(key);
  if (!object) {
    if (key.startsWith('assets/')) return missingPlaceholder();
    return fail('NOT_FOUND', key, 404);
  }
  return new Response(object.body, {
    headers: {
      'content-type': mimeOf(key),
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    },
  });
}

function missingPlaceholder(): Response {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">' +
    '<rect width="320" height="120" fill="#eef0f4"/>' +
    '<path d="M0 120 L120 0 M80 120 L200 0 M160 120 L280 0" stroke="#dde2ea" stroke-width="10"/>' +
    '<text x="160" y="66" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#8a93a3">素材已失效</text>' +
    '</svg>';
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
}
