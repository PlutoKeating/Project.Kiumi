import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export interface WeChatConfig {
  appId: string;
  appSecret: string;
  defaultThumbMediaId?: string;
  apiBase?: string;
}

export interface WeChatDraftArticle {
  title: string;
  author?: string;
  digest?: string;
  content: string;
  contentSourceUrl?: string;
  thumbMediaId?: string;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

export class WeChatError extends Error {
  readonly errcode: number;

  constructor(message: string, errcode: number) {
    super(message);
    this.name = 'WeChatError';
    this.errcode = errcode;
  }
}

/** Minimal WeChat official-account client: token cache, draft add, image material. */
export class WeChatClient {
  private readonly config: WeChatConfig;
  private readonly base: string;
  private cache?: TokenCache;

  constructor(config: WeChatConfig) {
    this.config = config;
    this.base = config.apiBase ?? 'https://api.weixin.qq.com';
  }

  static fromEnv(): WeChatClient | null {
    const appId = process.env.WECHAT_APP_ID;
    const appSecret = process.env.WECHAT_APP_SECRET;
    if (!appId || !appSecret) return null;
    return new WeChatClient({
      appId,
      appSecret,
      defaultThumbMediaId: process.env.WECHAT_DEFAULT_THUMB_MEDIA_ID,
    });
  }

  async accessToken(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now() + 60_000) return this.cache.value;
    const url = `${this.base}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(
      this.config.appId,
    )}&secret=${encodeURIComponent(this.config.appSecret)}`;
    const response = await fetch(url);
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!body.access_token) {
      throw new WeChatError(body.errmsg ?? 'failed to obtain access_token', body.errcode ?? -1);
    }
    this.cache = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000,
    };
    return this.cache.value;
  }

  async addDraft(article: WeChatDraftArticle): Promise<string> {
    const token = await this.accessToken();
    const thumb = article.thumbMediaId ?? this.config.defaultThumbMediaId;
    if (!thumb) {
      throw new WeChatError(
        'thumb_media_id is required: upload an image as material or set WECHAT_DEFAULT_THUMB_MEDIA_ID',
        -1,
      );
    }
    const response = await fetch(`${this.base}/cgi-bin/draft/add?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        articles: [
          {
            title: article.title,
            author: article.author ?? '',
            digest: article.digest ?? '',
            content: article.content,
            content_source_url: article.contentSourceUrl ?? '',
            thumb_media_id: thumb,
            need_open_comment: 0,
            only_fans_can_comment: 0,
          },
        ],
      }),
    });
    const body = (await response.json()) as {
      media_id?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!body.media_id) {
      throw new WeChatError(body.errmsg ?? 'draft/add failed', body.errcode ?? -1);
    }
    return body.media_id;
  }

  async addImageMaterial(bytes: Buffer, filename: string): Promise<{ mediaId: string; url: string }> {
    const token = await this.accessToken();
    const form = new FormData();
    form.append('media', new Blob([bytes]), filename);
    const response = await fetch(
      `${this.base}/cgi-bin/material/add_material?access_token=${token}&type=image`,
      { method: 'POST', body: form },
    );
    const body = (await response.json()) as {
      media_id?: string;
      url?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!body.media_id) {
      throw new WeChatError(body.errmsg ?? 'material/add_material failed', body.errcode ?? -1);
    }
    return { mediaId: body.media_id, url: body.url ?? '' };
  }
}


// ---------------------------------------------------------------------------
// Default cover
// ---------------------------------------------------------------------------

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Minimal solid-colour PNG so a draft always has a cover. */
export function generateCoverPng(width = 900, height = 500): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowLength;
    raw[offset] = 0;
    for (let x = 0; x < width; x++) {
      const p = offset + 1 + x * 3;
      // A soft vertical gradient reads better than a flat block.
      const tone = 232 - Math.round((y / height) * 28);
      raw[p] = tone;
      raw[p + 1] = tone + 2;
      raw[p + 2] = tone + 8;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface EnsureCoverOptions {
  cacheFile: string;
  explicit?: string;
}

/**
 * Resolve a thumb media id: env/config first, otherwise upload a generated
 * cover once and cache the id.
 */
export async function ensureCoverMediaId(
  client: WeChatClient,
  options: EnsureCoverOptions,
): Promise<string> {
  if (options.explicit) return options.explicit;
  try {
    const cached = JSON.parse(await readFile(options.cacheFile, 'utf8')) as { mediaId?: string };
    if (cached.mediaId) return cached.mediaId;
  } catch {
    // no cache yet
  }
  const png = generateCoverPng();
  const digest = createHash('sha256').update(png).digest('hex').slice(0, 12);
  const { mediaId } = await client.addImageMaterial(png, `kiumi-cover-${digest}.png`);
  await mkdir(path.dirname(options.cacheFile), { recursive: true });
  await writeFile(options.cacheFile, `${JSON.stringify({ mediaId, digest }, null, 2)}\n`, 'utf8');
  return mediaId;
}
