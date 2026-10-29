import {
  fillMatrix,
  normalizeMatrix,
  renderDocument,
  validateHtml,
  type KiumiDocument,
  type TemplateRecord,
} from '@kiumi/core';
import { currentUser, handleAuth } from './auth.js';

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
  if (env.KIUMI_DATA) {
    const response = await env.KIUMI_DATA.fetch(`http://kiumi-data/${key}`, {
      headers: { 'x-data-key': env.KIUMI_DATA_KEY ?? '' },
    });
    if (response.ok) return response;
  }
  if (!env.KIUMI_DATA_ORIGIN) return null;
  const response = await fetch(`${env.KIUMI_DATA_ORIGIN.replace(/\/$/, '')}/${key}`, {
    headers: { 'x-data-key': env.KIUMI_DATA_KEY ?? '' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
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

interface TokenCache {
  value: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

async function wechatToken(env: Env): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential' +
    `&appid=${encodeURIComponent(env.WECHAT_APP_ID ?? '')}` +
    `&secret=${encodeURIComponent(env.WECHAT_APP_SECRET ?? '')}`;
  const body = (await (await fetch(url)).json()) as {
    access_token?: string;
    expires_in?: number;
    errmsg?: string;
  };
  if (!body.access_token) throw new Error(body.errmsg ?? 'access_token failed');
  tokenCache = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000 };
  return tokenCache.value;
}

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
      if (path === '/api/documents') return documents(env, request, await ownerOf(request, env));
      if (path.startsWith('/api/documents/'))
        return documentItem(env, request, path, await ownerOf(request, env));
      if (path === '/api/wechat/config')
        return json({ configured: Boolean(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET) });
      if (path === '/api/wechat/draft' && request.method === 'POST') return wechatDraft(env, request);
      if (path.startsWith('/assets/')) return serveR2(env, `assets/${path.slice('/assets/'.length)}`);
      if (path === '/assets/__missing.svg') return missingPlaceholder();
      if (path.startsWith('/uploads/')) return serveR2(env, `uploads/${path.slice('/uploads/'.length)}`);
      if (path === '/api/assets/upload' && request.method === 'POST') return upload(env, request);

      return env.ASSETS.fetch(request);
    } catch (error) {
      return fail('INTERNAL_ERROR', (error as Error).message, 500);
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
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);

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

async function preview(env: Env, url: URL): Promise<Response> {
  const id = url.searchParams.get('id');
  if (!id) return fail('INVALID_BODY', 'missing ?id=');
  const record = await getRecord(env, id);
  if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${id}`, 404);
  return new Response(localizeAssets(record.html, await manifest(env)), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
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

function localizeAssets(html: string, map: Record<string, { path: string }>): string {
  return html.replace(
    /(?:https?:)?\/\/[^"'()\s]+\.(?:png|jpe?g|gif|svg|webp|bmp)(?:\?[^"'()\s]*)?/gi,
    (raw) => {
      const normalized = raw.startsWith('//') ? `https:${raw}` : raw.replace(/^http:\/\//, 'https://');
      const entry = map[normalized];
      return entry ? `/assets/${entry.path}` : '/assets/__missing.svg';
    },
  );
}

async function render(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as {
    document?: KiumiDocument;
    tplId?: string;
    matrix?: unknown;
    set?: Record<string, string>;
    localAssets?: boolean;
  };
  const skeletonsMap = await skeletons(env);
  const map = await manifest(env);

  let html: string;
  let warnings: unknown[] = [];

  if (body.document) {
    const result = renderDocument(body.document, skeletonsMap);
    html = result.html;
    warnings = result.warnings;
  } else if (body.tplId) {
    const record = await getRecord(env, body.tplId);
    if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${body.tplId}`, 404);
    const matrix = body.set ? fillMatrix(record.matrix, body.set) : record.matrix;
    const result = renderDocument(
      {
        version: 1,
        id: 'tmp',
        title: '',
        blocks: [{ kind: 'library', id: 'b', tplId: record.atomTplId, matrix }],
        meta: { createdAt: '', updatedAt: '' },
      },
      skeletonsMap,
      { recordedHtml: (tplId) => (tplId === record.atomTplId ? record.html : undefined) },
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

  if (body.localAssets) html = localizeAssets(html, map);
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

/** Documents belong to the signed-in user; without a configured issuer they fall back to one shared space. */
async function ownerOf(request: Request, env: Env): Promise<string | null> {
  if (!env.ID_ISSUER_URL || !env.ID_CLIENT_ID) return 'anonymous';
  const user = await currentUser(request, env);
  return user?.sub ?? null;
}

async function documents(env: Env, request: Request, owner: string | null): Promise<Response> {
  if (!owner) return fail('LOGIN_REQUIRED', 'sign in to keep documents', 401);
  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT id, title, updated_at, length(blocks) AS size FROM documents WHERE owner_sub = ? ORDER BY updated_at DESC',
    )
      .bind(owner)
      .all();
    return json(rows.results ?? []);
  }
  if (request.method === 'POST') {
    const { title } = (await request.json()) as { title?: string };
    if (!title) return fail('INVALID_BODY', 'title is required');
    const id = `doc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const doc: KiumiDocument = {
      version: 1,
      id,
      title,
      blocks: [],
      meta: { createdAt: now, updatedAt: now },
    };
    await env.DB.prepare('INSERT INTO documents (id, title, blocks, updated_at, owner_sub) VALUES (?, ?, ?, ?, ?)')
      .bind(id, title, JSON.stringify(doc.blocks), now, owner)
      .run();
    return json(doc);
  }
  return fail('METHOD_NOT_ALLOWED', request.method, 405);
}

async function documentItem(
  env: Env,
  request: Request,
  path: string,
  owner: string | null,
): Promise<Response> {
  if (!owner) return fail('LOGIN_REQUIRED', 'sign in to keep documents', 401);
  const id = decodeURIComponent(path.slice('/api/documents/'.length));
  const row = await env.DB.prepare(
    'SELECT id, title, blocks, updated_at FROM documents WHERE id = ? AND owner_sub = ?',
  )
    .bind(id, owner)
    .first<{ id: string; title: string; blocks: string; updated_at: string }>();
  if (!row) return fail('DOCUMENT_NOT_FOUND', `no document ${id}`, 404);

  if (request.method === 'GET') {
    return json({
      version: 1,
      id: row.id,
      title: row.title,
      blocks: JSON.parse(row.blocks),
      meta: { createdAt: row.updated_at, updatedAt: row.updated_at },
    });
  }
  if (request.method === 'PATCH') {
    const patch = (await request.json()) as { title?: string; blocks?: unknown[] };
    const title = patch.title ?? row.title;
    const blocks = patch.blocks ? JSON.stringify(patch.blocks) : row.blocks;
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE documents SET title = ?, blocks = ?, updated_at = ? WHERE id = ?')
      .bind(title, blocks, now, id)
      .run();
    return json({ ok: true, id, title, updatedAt: now });
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
    return json({ deleted: id });
  }
  return fail('METHOD_NOT_ALLOWED', request.method, 405);
}

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

async function upload(env: Env, request: Request): Promise<Response> {
  if (!env.DATA) return fail('R2_NOT_ENABLED', 'R2 bucket is not configured yet', 503);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return fail('INVALID_BODY', 'multipart field "file" is required');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '.bin';
  const key = `uploads/${digest}${ext}`;
  await env.DATA.put(key, bytes, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  return json({ sha256: digest, bytes: bytes.length, url: `/${key}` });
}

// ---------------------------------------------------------------------------
// WeChat
// ---------------------------------------------------------------------------

async function wechatDraft(env: Env, request: Request): Promise<Response> {
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) {
    return fail('WECHAT_NOT_CONFIGURED', 'set WECHAT_APP_ID / WECHAT_APP_SECRET', 501);
  }
  const body = (await request.json()) as { documentId?: string; thumbMediaId?: string; author?: string };
  if (!body.documentId) return fail('INVALID_BODY', 'documentId is required');
  const row = await env.DB.prepare('SELECT id, title, blocks FROM documents WHERE id = ?')
    .bind(body.documentId)
    .first<{ id: string; title: string; blocks: string }>();
  if (!row) return fail('DOCUMENT_NOT_FOUND', `no document ${body.documentId}`, 404);

  const doc: KiumiDocument = {
    version: 1,
    id: row.id,
    title: row.title,
    blocks: JSON.parse(row.blocks),
    meta: { createdAt: '', updatedAt: '' },
  };
  const result = renderDocument(doc, await skeletons(env));
  const thumb = body.thumbMediaId ?? env.WECHAT_DEFAULT_THUMB_MEDIA_ID;
  if (!thumb) return fail('WECHAT_NOT_CONFIGURED', 'thumb_media_id is required', 501);

  const token = await wechatToken(env);
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      articles: [
        {
          title: row.title,
          author: body.author ?? '',
          digest: '',
          content: result.html,
          content_source_url: '',
          thumb_media_id: thumb,
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    }),
  });
  const payload = (await response.json()) as { media_id?: string; errmsg?: string };
  if (!payload.media_id) return fail('WECHAT_API_ERROR', payload.errmsg ?? 'draft/add failed', 502);
  return json({ mediaId: payload.media_id, bytes: result.bytes });
}
