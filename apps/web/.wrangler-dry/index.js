// worker/index.ts
var PROXY_PREFIXES = ["/api/", "/assets/", "/uploads/"];
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const shouldProxy = PROXY_PREFIXES.some(
      (prefix) => url.pathname === prefix.slice(0, -1) || url.pathname.startsWith(prefix)
    );
    if (!shouldProxy) return env.ASSETS.fetch(request);
    const origin = env.API_ORIGIN?.replace(/\/$/, "");
    if (!origin) {
      return Response.json(
        { ok: false, error: { code: "API_ORIGIN_MISSING", message: "API_ORIGIN is not configured" } },
        { status: 503 }
      );
    }
    const target = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.set("host", new URL(origin).host);
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body,
      redirect: "manual"
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
