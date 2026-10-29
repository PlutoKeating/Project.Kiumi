export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Raw `Cookie` header value. Never logged, never persisted. */
  cookie?: string;
  signal?: AbortSignal;
}

export interface FetchResult {
  url: string;
  status: number;
  headers: Headers;
  text: string;
}

export interface BytesResult {
  url: string;
  status: number;
  headers: Headers;
  bytes: Buffer;
}

/** Token-bucket limiter that keeps a hard floor between requests. */
export class RateLimiter {
  private readonly intervalMs: number;
  private nextAt = 0;

  constructor(requestsPerSecond: number) {
    const rps = Number.isFinite(requestsPerSecond) && requestsPerSecond > 0 ? requestsPerSecond : 2;
    this.intervalMs = 1000 / rps;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAt - now);
    this.nextAt = Math.max(now, this.nextAt) + this.intervalMs;
    if (wait > 0) await sleep(wait);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

/** Fetch text with retry, backoff and a rate limiter shared by the caller. */
export async function fetchText(
  url: string,
  limiter: RateLimiter,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 30_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire();
    if (options.signal?.aborted) throw new Error('aborted');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: '*/*',
        ...options.headers,
      };
      if (options.cookie) headers.cookie = options.cookie;

      const response = await fetch(url, {
        headers,
        signal: options.signal ?? controller.signal,
        redirect: 'follow',
      });
      const text = await response.text();

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          await backoff(attempt);
          continue;
        }
        throw new HttpError(`HTTP ${response.status} for ${url}`, response.status, url);
      }
      return { url, status: response.status, headers: response.headers, text };
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && !RETRYABLE_STATUS.has(error.status)) throw error;
      if (attempt >= retries) break;
      await backoff(attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Fetch raw bytes. Assets are binary; never route them through `text()`. */
export async function fetchBytes(
  url: string,
  limiter: RateLimiter,
  options: FetchOptions = {},
): Promise<BytesResult> {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 45_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire();
    if (options.signal?.aborted) throw new Error('aborted');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: 'image/*,*/*;q=0.8',
        ...options.headers,
      };
      if (options.cookie) headers.cookie = options.cookie;

      const response = await fetch(url, {
        headers,
        signal: options.signal ?? controller.signal,
        redirect: 'follow',
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          await backoff(attempt);
          continue;
        }
        throw new HttpError(`HTTP ${response.status} for ${url}`, response.status, url);
      }
      return { url, status: response.status, headers: response.headers, bytes: buffer };
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && !RETRYABLE_STATUS.has(error.status)) throw error;
      if (attempt >= retries) break;
      await backoff(attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function backoff(attempt: number): Promise<void> {
  const base = Math.min(8_000, 400 * 2 ** attempt);
  const jitter = Math.random() * 250;
  return sleep(base + jitter);
}

export interface JsonEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

/** Fetch and unwrap the upstream `{ code, message, data }` envelope. */
export async function fetchJson<T>(
  url: string,
  limiter: RateLimiter,
  options: FetchOptions = {},
): Promise<T> {
  const { text } = await fetchText(url, limiter, options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`expected JSON from ${url}, got ${text.slice(0, 120)}`);
  }
  const envelope = parsed as JsonEnvelope<T>;
  if (envelope && typeof envelope === 'object' && 'code' in envelope) {
    if (envelope.code !== 0) {
      throw new HttpError(
        `upstream error ${envelope.code}: ${envelope.message} (${url})`,
        envelope.code === -102 ? 401 : 400,
        url,
      );
    }
    return envelope.data;
  }
  return parsed as T;
}
