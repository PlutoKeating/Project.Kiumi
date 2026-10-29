import type { Env } from './index.js';

/** All private data traffic uses the same authenticated transport. */
export async function dataFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-data-key', env.KIUMI_DATA_KEY ?? '');
  const options = { ...init, headers, signal: init.signal ?? AbortSignal.timeout(60_000) };
  if (env.KIUMI_DATA) return env.KIUMI_DATA.fetch(`http://kiumi-data/${path}`, options);
  if (env.KIUMI_DATA_ORIGIN?.startsWith('https://')) {
    return fetch(`${env.KIUMI_DATA_ORIGIN.replace(/\/$/, '')}/${path}`, options);
  }
  throw new Error('数据服务尚未连接');
}
