/**
 * Single-origin edge entry.
 *
 * - `/api/*`, `/assets/*`, `/uploads/*` are proxied to the origin API (a local
 *   Node process exposed through a Cloudflare Tunnel, or a VPS).
 * - Everything else is served from the built SPA.
 *
 * Same origin means the frontend keeps using relative URLs, the rendered HTML
 * keeps its `/assets/...` media paths, and no CORS is involved.
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  API_ORIGIN: string;
}

const PROXY_PREFIXES = ['/api/', '/assets/', '/uploads/'];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const shouldProxy = PROXY_PREFIXES.some(
      (prefix) => url.pathname === prefix.slice(0, -1) || url.pathname.startsWith(prefix),
    );

    if (!shouldProxy) return env.ASSETS.fetch(request);

    const origin = env.API_ORIGIN?.replace(/\/$/, '');
    if (!origin) {
      return Response.json(
        { ok: false, error: { code: 'API_ORIGIN_MISSING', message: 'API_ORIGIN is not configured' } },
        { status: 503 },
      );
    }

    const target = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.set('host', new URL(origin).host);

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
