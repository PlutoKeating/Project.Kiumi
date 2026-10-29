import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { rewriteAssetUrls, rewriteAssetUrlsStrict, type AssetManifest } from '@kiumi/catalog';
import { validateHtml, type KiumiDocument } from '@kiumi/core';
import { DocumentBuilder, FileDocumentStore, KiumiClient, fillMatrix } from '@kiumi/sdk';
import { WeChatClient, WeChatError } from '@kiumi/sdk';

export interface AppOptions {
  dataDir: string;
  host?: string;
  port?: number;
  logger?: boolean;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.json': 'application/json',
};

function envelope(data: unknown, meta?: unknown) {
  return meta === undefined ? { ok: true, data } : { ok: true, data, meta };
}

/** Resolve a path inside a root directory, refusing traversal. */
function safeJoin(root: string, relative: string): string {
  const target = path.resolve(root, relative.replace(/^\/+/, ''));
  const normalizedRoot = path.resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new ApiError('FORBIDDEN', 'path escapes the asset root', 403);
  }
  return target;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const dataDir = path.resolve(options.dataDir);
  const kiumi = new KiumiClient({ dataDir });
  const documents = new FileDocumentStore(dataDir);
  const uploadsDir = path.join(dataDir, 'uploads');
  const assetsDir = path.join(dataDir, 'assets');

  let manifestCache: AssetManifest | null = null;
  const manifest = async (): Promise<AssetManifest> => {
    if (!manifestCache) {
      try {
        manifestCache = JSON.parse(
          await readFile(path.join(dataDir, 'catalog/assets-manifest.json'), 'utf8'),
        ) as AssetManifest;
      } catch {
        manifestCache = {};
      }
    }
    return manifestCache;
  };

  // Product rule: the app never reaches the upstream CDN at runtime. Anything
  // not mirrored is replaced by a local placeholder and reported. Set
  // KIUMI_STRICT_ASSETS=0 to allow the remote fallback while mirroring.
  const strictAssets = process.env.KIUMI_STRICT_ASSETS !== '0';

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 32 * 1024 * 1024 });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  app.setErrorHandler((error, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      reply.status(error.status).send({
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    if (error instanceof WeChatError) {
      reply.status(502).send({
        ok: false,
        error: { code: 'WECHAT_API_ERROR', message: error.message, details: { errcode: error.errcode } },
      });
      return;
    }
    const failure = error as Error & { statusCode?: number };
    reply.status(failure.statusCode ?? 500).send({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: failure.message },
    });
  });

  // -------------------------------------------------------------------------
  // Catalog
  // -------------------------------------------------------------------------

  app.get('/api/health', async () => envelope({ ok: true, dataDir }));

  app.get('/api/rooms', async (request) => {
    const { house, floor } = request.query as { house?: string; floor?: string };
    return envelope(await kiumi.rooms({ house, floor }));
  });

  app.get('/api/templates', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const result = await kiumi.list({
      room: query.room,
      q: query.q,
      hasSvg: query.hasSvg === undefined ? undefined : query.hasSvg === 'true',
      accessibility: query.accessibility,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    });
    return { ok: true, data: result.items, meta: { count: result.items.length, total: result.total } };
  });

  app.get('/api/template', async (request) => {
    const { id } = request.query as { id?: string };
    if (!id) throw new ApiError('INVALID_BODY', 'missing ?id=');
    const record = await kiumi.get(decodeURIComponent(id));
    if (!record) throw new ApiError('TEMPLATE_NOT_FOUND', `no template ${id}`, 404);
    return envelope(record);
  });

  app.get('/api/template/preview', async (request, reply) => {
    const { id } = request.query as { id?: string };
    if (!id) throw new ApiError('INVALID_BODY', 'missing ?id=');
    const record = await kiumi.get(decodeURIComponent(id));
    if (!record) throw new ApiError('TEMPLATE_NOT_FOUND', `no template ${id}`, 404);
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    const rewritten = rewriteAssetUrlsStrict(record.html, await manifest(), {
      strict: strictAssets,
    });
    if (rewritten.missing.length) {
      reply.header('x-kiumi-missing-assets', String(rewritten.missing.length));
    }
    return rewritten.html;
  });

  app.get('/api/search', async (request) => {
    const { q, limit } = request.query as { q?: string; limit?: string };
    if (!q) throw new ApiError('INVALID_BODY', 'missing ?q=');
    return envelope(await kiumi.search(q, limit ? Number(limit) : 20));
  });

  app.get('/api/assets', async (request) => {
    const { q, limit, offset } = request.query as {
      q?: string;
      limit?: string;
      offset?: string;
    };
    const entries = Object.entries(await manifest())
      .filter(([url]) => !q || url.toLowerCase().includes(q.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    const start = offset ? Number(offset) : 0;
    const size = limit ? Number(limit) : 60;
    const items = entries.slice(start, start + size).map(([url, entry]) => ({
      url,
      path: entry.path,
      bytes: entry.bytes ?? 0,
    }));
    return { ok: true, data: items, meta: { total: entries.length } };
  });

  app.get('/api/slots', async (request) => {
    const { id } = request.query as { id?: string };
    if (!id) throw new ApiError('INVALID_BODY', 'missing ?id=');
    return envelope(await kiumi.slots(decodeURIComponent(id)));
  });

  // -------------------------------------------------------------------------
  // Render and validate
  // -------------------------------------------------------------------------

  let coverageCache: { at: number; value: unknown } | null = null;

  app.get('/api/assets/coverage', async () => {
    if (coverageCache && Date.now() - coverageCache.at < 60_000) return envelope(coverageCache.value);
    const manifestMap = await manifest();
    let required: string[] = [];
    try {
      required = JSON.parse(
        await readFile(path.join(dataDir, 'catalog/assets-required.json'), 'utf8'),
      ) as string[];
    } catch {
      required = [];
    }
    const mirrored = required.filter((url) => manifestMap[url]).length;
    const value = {
      referenced: required.length,
      mirrored,
      coverage: required.length ? Number((mirrored / required.length).toFixed(4)) : 1,
      strict: strictAssets,
      missing: required.filter((url) => !manifestMap[url]).slice(0, 20),
    };
    coverageCache = { at: Date.now(), value };
    return envelope(value);
  });

  app.post('/api/render', async (request, reply) => {
    const body = (request.body ?? {}) as {
      document?: KiumiDocument;
      tplId?: string;
      matrix?: unknown;
      set?: Record<string, string>;
      localAssets?: boolean;
    };

    let html: string;
    let warnings: unknown[] = [];

    if (body.document) {
      const result = await kiumi.renderDocument(body.document);
      html = result.html;
      warnings = result.warnings;
    } else if (body.tplId) {
      const result = body.set ? await kiumi.fill(body.tplId, body.set) : await kiumi.render(
        (await kiumi.get(body.tplId))?.matrix,
      );
      html = result.html;
      warnings = 'warnings' in result ? result.warnings : [];
      if (!html && !body.set) throw new ApiError('TEMPLATE_NOT_FOUND', `no template ${body.tplId}`, 404);
    } else if (body.matrix !== undefined) {
      const result = await kiumi.render(body.matrix);
      html = result.html;
      warnings = result.warnings;
    } else {
      throw new ApiError('INVALID_BODY', 'provide document, tplId or matrix');
    }

    if (body.localAssets) {
      const rewritten = rewriteAssetUrlsStrict(html, await manifest(), { strict: strictAssets });
      if (rewritten.missing.length) reply.header('x-kiumi-missing-assets', String(rewritten.missing.length));
      html = rewritten.html;
    }

    const issues = validateHtml(html);
    return envelope({ html, bytes: Buffer.byteLength(html, 'utf8'), warnings, issues });
  });

  app.post('/api/validate', async (request) => {
    const { html, maxBytes } = (request.body ?? {}) as { html?: string; maxBytes?: number };
    if (typeof html !== 'string') throw new ApiError('INVALID_BODY', 'html is required');
    return envelope({
      bytes: Buffer.byteLength(html, 'utf8'),
      issues: validateHtml(html, { maxBytes }),
    });
  });

  app.post('/api/fill', async (request) => {
    const { tplId, set } = (request.body ?? {}) as { tplId?: string; set?: Record<string, string> };
    if (!tplId) throw new ApiError('INVALID_BODY', 'tplId is required');
    const record = await kiumi.get(tplId);
    if (!record) throw new ApiError('TEMPLATE_NOT_FOUND', `no template ${tplId}`, 404);
    const matrix = fillMatrix(record.matrix, set ?? {});
    const rendered = await kiumi.render(matrix);
    return envelope({ matrix, html: rendered.html, warnings: rendered.warnings });
  });

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  app.get('/api/documents', async () => envelope(await documents.list()));

  app.post('/api/documents', async (request) => {
    const { title, blocks } = (request.body ?? {}) as { title?: string; blocks?: unknown[] };
    if (!title) throw new ApiError('INVALID_BODY', 'title is required');
    const doc = await documents.create(title);
    if (Array.isArray(blocks) && blocks.length) {
      doc.blocks = blocks as KiumiDocument['blocks'];
      await documents.put(doc);
    }
    return envelope(doc);
  });

  app.get('/api/documents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const doc = await documents.get(id);
    if (!doc) throw new ApiError('DOCUMENT_NOT_FOUND', `no document ${id}`, 404);
    return envelope(doc);
  });

  app.patch('/api/documents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const doc = await documents.get(id);
    if (!doc) throw new ApiError('DOCUMENT_NOT_FOUND', `no document ${id}`, 404);
    const patch = (request.body ?? {}) as { title?: string; blocks?: KiumiDocument['blocks'] };
    if (patch.title !== undefined) doc.title = patch.title;
    if (patch.blocks !== undefined) doc.blocks = patch.blocks;
    doc.meta.updatedAt = new Date().toISOString();
    await documents.put(doc);
    return envelope(doc);
  });

  app.delete('/api/documents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const removed = await documents.delete(id);
    if (!removed) throw new ApiError('DOCUMENT_NOT_FOUND', `no document ${id}`, 404);
    return envelope({ deleted: id });
  });

  app.post('/api/documents/:id/blocks', async (request) => {
    const { id } = request.params as { id: string };
    const doc = await documents.get(id);
    if (!doc) throw new ApiError('DOCUMENT_NOT_FOUND', `no document ${id}`, 404);
    const body = (request.body ?? {}) as {
      atomTplId?: string;
      node?: unknown;
      index?: number;
      fill?: Record<string, string>;
    };
    const builder = DocumentBuilder.fromJSON(doc);
    if (body.atomTplId) {
      const record = await kiumi.get(body.atomTplId);
      if (!record) throw new ApiError('TEMPLATE_NOT_FOUND', `no template ${body.atomTplId}`, 404);
      builder.addLibraryBlock(
        {
          atomTplId: record.atomTplId,
          matrix: body.fill ? fillMatrix(record.matrix, body.fill) : record.matrix,
        },
        body.index,
      );
    } else if (body.node) {
      builder.addNativeBlock(body.node as never, body.index);
    } else {
      throw new ApiError('INVALID_BODY', 'provide atomTplId or node');
    }
    await documents.put(builder.toJSON());
    return envelope({ documentId: id, blocks: builder.doc.blocks.length });
  });

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  const serveFile = async (reply: FastifyReply, file: string): Promise<unknown> => {
    const info = await stat(file);
    if (!info.isFile()) throw new ApiError('FORBIDDEN', 'not a file', 403);
    const ext = path.extname(file).toLowerCase();
    const body = await readFile(file);
    reply.header('content-type', MIME[ext] ?? 'application/octet-stream');
    reply.header('etag', `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(body);
  };

  // Served from code, so it survives a fresh clone with no mirrored files.
  app.get('/assets/__missing.svg', async (_request, reply) => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">',
      '<rect width="320" height="120" fill="#eef0f4"/>',
      '<path d="M0 120 L120 0 M80 120 L200 0 M160 120 L280 0" stroke="#dde2ea" stroke-width="10"/>',
      '<text x="160" y="66" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#8a93a3">素材已失效</text>',
      '</svg>',
    ].join('');
    reply.header('content-type', 'image/svg+xml; charset=utf-8');
    reply.header('cache-control', 'public, max-age=86400');
    return svg;
  });

  app.get('/assets/*', async (request, reply) => {
    const relative = (request.params as { '*': string })['*'];
    return serveFile(reply, safeJoin(assetsDir, relative));
  });

  app.get('/uploads/*', async (request, reply) => {
    const relative = (request.params as { '*': string })['*'];
    return serveFile(reply, safeJoin(uploadsDir, relative));
  });

  app.get('/api/uploads', async () => {
    const dir = uploadsDir;
    const entries = await readdir(dir).catch(() => [] as string[]);
    const items = [];
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const info = await stat(path.join(dir, name)).catch(() => null);
      if (!info?.isFile()) continue;
      items.push({ name, bytes: info.size, mtime: info.mtimeMs, url: `/uploads/${name}` });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return envelope(items);
  });

  app.post('/api/assets/upload', async (request) => {
    const part = await (request as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> }> }).file();
    if (!part) throw new ApiError('INVALID_BODY', 'multipart field "file" is required');
    const bytes = await part.toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const ext = path.extname(part.filename || '').toLowerCase() || '.bin';
    const name = `${hash}${ext}`;
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, name), bytes);
    return envelope({ sha256: hash, bytes: bytes.byteLength, url: `/uploads/${name}` });
  });

  // -------------------------------------------------------------------------
  // WeChat
  // -------------------------------------------------------------------------

  app.get('/api/wechat/config', async () =>
    envelope({ configured: WeChatClient.fromEnv() !== null }),
  );

  app.post('/api/wechat/material', async (request) => {
    const client = WeChatClient.fromEnv();
    if (!client) throw new ApiError('WECHAT_NOT_CONFIGURED', 'set WECHAT_APP_ID / WECHAT_APP_SECRET', 501);
    const part = await (request as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> }> }).file();
    if (!part) throw new ApiError('INVALID_BODY', 'multipart field "file" is required');
    const bytes = await part.toBuffer();
    const result = await client.addImageMaterial(bytes, part.filename || 'image.png');
    return envelope(result);
  });

  app.post('/api/wechat/draft', async (request) => {
    const client = WeChatClient.fromEnv();
    if (!client) throw new ApiError('WECHAT_NOT_CONFIGURED', 'set WECHAT_APP_ID / WECHAT_APP_SECRET', 501);
    const body = (request.body ?? {}) as {
      documentId?: string;
      thumbMediaId?: string;
      author?: string;
      digest?: string;
    };
    if (!body.documentId) throw new ApiError('INVALID_BODY', 'documentId is required');
    const doc = await documents.get(body.documentId);
    if (!doc) throw new ApiError('DOCUMENT_NOT_FOUND', `no document ${body.documentId}`, 404);
    const rendered = await kiumi.renderDocument(doc);
    const mediaId = await client.addDraft({
      title: doc.title,
      author: body.author,
      digest: body.digest,
      content: rendered.html,
      thumbMediaId: body.thumbMediaId,
    });
    return envelope({ mediaId, bytes: rendered.bytes });
  });

  return app;
}
