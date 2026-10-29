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
