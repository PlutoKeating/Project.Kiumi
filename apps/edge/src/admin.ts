/**
 * Site admin API (model providers). Admins are the logins listed in
 * KIUMI_ADMIN_SUBS (account `sub` or email, comma separated). Only browser
 * sessions qualify: MCP bearer tokens never administer the site.
 */
import { currentUser, type SessionUser } from './auth.js';
import { getCatalog } from './catalog.js';
import type { Env } from './index.js';
import { PROTOCOLS, callTarget, configView, decryptKey, loadConfig, saveConfig, type Protocol, type SaveInput } from './llm.js';
import { ApiError, reply } from './workspace.js';

export function isAdmin(env: Env, user: SessionUser | null): boolean {
  if (!user) return false;
  const list = (env.KIUMI_ADMIN_SUBS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.sub.toLowerCase()) || (!!user.email && list.includes(user.email.toLowerCase()));
}

async function requireAdmin(request: Request, env: Env): Promise<SessionUser> {
  if (request.headers.get('authorization')) throw new ApiError(403, 'ADMIN_SESSION_REQUIRED', '管理接口只接受网页登录');
  const user = await currentUser(request, env);
  if (!user) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录');
  if (!isAdmin(env, user)) throw new ApiError(403, 'ADMIN_REQUIRED', (env.KIUMI_ADMIN_SUBS ?? '').trim() ? '你不是站点管理员' : '还没有设置站点管理员（部署变量 KIUMI_ADMIN_SUBS）');
  if (!['GET', 'HEAD'].includes(request.method) && !/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) throw new ApiError(415, 'JSON_REQUIRED', '请求体需要是 JSON');
  return user;
}

async function catalogSource(env: Env) {
  const cfg = await loadConfig(env);
  return cfg.catalogUrl || env.MODEL_CATALOG_URL || null;
}

export async function adminRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/admin/')) return null;
  const user = await requireAdmin(request, env);

  if (path === '/api/admin/llm') {
    if (request.method === 'GET') return reply(await configView(env));
    if (request.method === 'PUT') return reply(await saveConfig(env, (await request.json()) as SaveInput, user.email ?? user.sub));
  }

  if (path === '/api/admin/catalog' && request.method === 'GET') {
    const { doc, error } = await getCatalog(await catalogSource(env), { refresh: url.searchParams.get('refresh') === '1' });
    return reply({
      source: doc?.source ?? (await catalogSource(env)),
      fetchedAt: doc?.fetchedAt ?? null,
      error: error ?? null,
      providers: (doc?.providers ?? []).map(({ models, ...p }) => ({ ...p, modelCount: models.length })),
    });
  }

  if (path === '/api/admin/catalog/models' && request.method === 'GET') {
    const { doc, error } = await getCatalog(await catalogSource(env));
    const provider = doc?.providers.find(p => p.id === url.searchParams.get('provider'));
    if (!provider) throw new ApiError(404, 'CATALOG_PROVIDER_NOT_FOUND', error ?? '目录里没有这个提供商');
    return reply({ provider: provider.id, models: provider.models });
  }

  if (path === '/api/admin/llm/test' && request.method === 'POST') {
    const body = (await request.json()) as { provider?: { id?: string; protocol?: Protocol; baseUrl?: string; headers?: Record<string, string> }; model?: string; keyId?: string; apiKey?: string };
    const p = body.provider ?? {};
    if (!p.id || !p.protocol || !PROTOCOLS.includes(p.protocol) || !p.baseUrl || !body.model) throw new ApiError(400, 'INVALID_BODY', '缺少提供商、协议、Base URL 或模型');
    let base: URL;
    try { base = new URL(p.baseUrl); } catch { throw new ApiError(400, 'INVALID_BODY', 'Base URL 无效'); }
    if (base.protocol !== 'https:') throw new ApiError(400, 'INVALID_BODY', 'Base URL 必须是 https');
    let apiKey = body.apiKey?.trim();
    if (!apiKey) {
      const saved = (await loadConfig(env)).providers.find(x => x.id === p.id);
      const key = saved?.keys.find(k => (body.keyId ? k.id === body.keyId : k.enabled));
      if (!key) throw new ApiError(400, 'NO_KEY', '这个提供商还没有保存过 Key：先填写 Key 再测试');
      apiKey = await decryptKey(env, p.id, key.enc);
    }
    const started = Date.now();
    try {
      const text = await callTarget({ protocol: p.protocol, baseUrl: p.baseUrl, model: body.model, apiKey, headers: p.headers ?? {} }, { system: 'You are a connectivity check.', prompt: '只回复两个字：可用', maxTokens: 512, timeoutMs: 30_000 });
      return reply({ ok: true, ms: Date.now() - started, sample: text.trim().slice(0, 80) });
    } catch (error) {
      return reply({ ok: false, ms: Date.now() - started, error: (error as Error).message.slice(0, 300) });
    }
  }

  throw new ApiError(404, 'NOT_FOUND', '没有这个管理接口');
}
