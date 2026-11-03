/**
 * Model providers, configured at runtime from the admin panel.
 *
 * The configuration is one JSON document in D1 (`settings` key `llm-config`)
 * read fresh on every model call, so an edit applies to the next request with
 * no deploy. Nothing about providers is in code: Base URLs, model ids, Keys,
 * extra headers and the call order all come from the document (or, for old
 * deployments without one, from the LLM_* variables).
 *
 * Keys are AES-GCM encrypted with a key derived from KIUMI_DATA_KEY; the
 * provider id is the AAD, so a Key cannot be moved to another provider. The
 * panel only ever sees the last four characters.
 */
import type { Env } from './index.js';
import { ApiError } from './workspace.js';

export type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
export const PROTOCOLS: Protocol[] = ['openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];
export type Purpose = 'annotate' | 'plan';
export const PURPOSES: Purpose[] = ['annotate', 'plan'];

export interface ProviderKey { id: string; label: string; enc: string; last4: string; enabled: boolean; addedAt: string }
export interface ProviderModel {
  id: string;
  enabled: boolean;
  order: number;
  /** Gateways that serve some models on another API (OpenCode Go, Zen): per-model overrides. */
  protocol?: Protocol;
  baseUrl?: string;
}
export interface Provider {
  id: string;
  name: string;
  catalogId: string | null;
  protocol: Protocol;
  baseUrl: string;
  enabled: boolean;
  /** Extra request headers some gateways require. */
  headers: Record<string, string>;
  /** Header that carries one stable id per import (e.g. OpenCode's `x-opencode-session`). */
  sessionHeader?: string;
  /** Client identification some gateways require; empty = DEFAULT_USER_AGENT. */
  userAgent?: string;
  keys: ProviderKey[];
  models: ProviderModel[];
}
export interface PurposeConfig {
  /** `providerId/modelId` in preference order; empty = the global order. */
  targets: string[];
  maxTokens: number;
  timeoutMs: number;
}
export interface LlmConfig {
  version: number;
  providers: Provider[];
  purposes: Record<Purpose, PurposeConfig>;
  /** Model catalog source (models.dev schema); empty = MODEL_CATALOG_URL. */
  catalogUrl: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_PURPOSES: Record<Purpose, PurposeConfig> = {
  annotate: { targets: [], maxTokens: 1500, timeoutMs: 30_000 },
  plan: { targets: [], maxTokens: 4000, timeoutMs: 60_000 },
};

const KEY = 'llm-config';
/** Identifies this client to gateways that ask for a non-generic User-Agent. */
export const DEFAULT_USER_AGENT = 'kiumi-typesetter/1.0';
const HEADER_RE = /^[a-z0-9-]{1,64}$/i;
const RESERVED_HEADER = /^(authorization|x-api-key|x-goog-api-key|host|content-length|content-type|user-agent)$/i;
export const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
const MODEL_RE = /^[^\s/][^\s]{0,199}$/;

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function secretKey(env: Env) {
  if (!env.KIUMI_DATA_KEY) throw new ApiError(503, 'NOT_CONFIGURED', '服务尚未配置 KIUMI_DATA_KEY，无法保存模型 Key');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`model-keys:${env.KIUMI_DATA_KEY}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptKey(env: Env, providerId: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(providerId) }, await secretKey(env), enc.encode(plain));
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`;
}
export async function decryptKey(env: Env, providerId: string, stored: string): Promise<string> {
  const [, iv, data] = stored.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(providerId) }, await secretKey(env), unb64(data));
  return new TextDecoder().decode(plain);
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const clampInt = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback);

function normalizePurposes(input: any): Record<Purpose, PurposeConfig> {
  const out = {} as Record<Purpose, PurposeConfig>;
  for (const p of PURPOSES) {
    const raw = input?.[p] ?? {};
    out[p] = {
      targets: Array.isArray(raw.targets) ? raw.targets.filter((t: unknown) => typeof t === 'string' && t.includes('/')).slice(0, 50) : [],
      maxTokens: clampInt(raw.maxTokens, 64, 64_000, DEFAULT_PURPOSES[p].maxTokens),
      timeoutMs: clampInt(raw.timeoutMs, 3_000, 180_000, DEFAULT_PURPOSES[p].timeoutMs),
    };
  }
  return out;
}

/** Global order renumbered 0..n-1 across providers. */
function renumber(providers: Provider[]) {
  providers.flatMap(p => p.models).sort((a, b) => a.order - b.order).forEach((m, i) => { m.order = i; });
}

export async function loadConfig(env: Env): Promise<LlmConfig & { stored: boolean }> {
  const row = await env.DB.prepare('SELECT value, version, updated_at, updated_by FROM settings WHERE key=?').bind(KEY).first<{ value: string; version: number; updated_at: string; updated_by: string | null }>().catch(() => null);
  if (!row) return { version: 0, providers: [], purposes: normalizePurposes(null), catalogUrl: '', stored: false };
  let value: Partial<LlmConfig> = {};
  try { value = JSON.parse(row.value); } catch { /* broken document reads as empty */ }
  return {
    version: row.version,
    providers: Array.isArray(value.providers) ? value.providers : [],
    purposes: normalizePurposes(value.purposes),
    catalogUrl: typeof value.catalogUrl === 'string' ? value.catalogUrl : '',
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? undefined,
    stored: true,
  };
}

/** Old deployments: a single provider from LLM_* variables, used only when no document exists. */
function envProvider(env: Env): { provider: Provider; key: string } | null {
  if (!env.LLM_API_URL || !env.LLM_API_KEY || !env.LLM_MODEL) return null;
  const protocol = PROTOCOLS.includes(env.LLM_PROTOCOL as Protocol) ? env.LLM_PROTOCOL as Protocol : 'openai-chat';
  // LLM_API_URL used to be the full chat-completions endpoint; accept both forms.
  const baseUrl = env.LLM_API_URL.replace(/\/chat\/completions\/?$/, '');
  return { provider: { id: 'env', name: '部署变量 LLM_*', catalogId: null, protocol, baseUrl, enabled: true, headers: {}, keys: [], models: [{ id: env.LLM_MODEL, enabled: true, order: 0 }] }, key: env.LLM_API_KEY };
}

export type ViewKey = Omit<ProviderKey, 'enc'> & { masked: string };
export type ViewProvider = Omit<Provider, 'keys'> & { keys: ViewKey[] };
export interface TargetSummary { id: string; providerId: string; modelId: string; order: number; callable: boolean; reason?: 'provider_disabled' | 'model_disabled' | 'no_key' }

export function describeTargets(providers: Provider[]): TargetSummary[] {
  return providers
    .flatMap(p => p.models.map(m => {
      const reason = !p.enabled ? 'provider_disabled' as const : !m.enabled ? 'model_disabled' as const : !p.keys.some(k => k.enabled) ? 'no_key' as const : undefined;
      return { id: `${p.id}/${m.id}`, providerId: p.id, modelId: m.id, order: m.order, callable: !reason, ...(reason ? { reason } : {}) };
    }))
    .sort((a, b) => a.order - b.order);
}

export async function configView(env: Env) {
  const cfg = await loadConfig(env);
  const fallback = !cfg.stored || !cfg.providers.length ? envProvider(env) : null;
  return {
    version: cfg.version,
    updatedAt: cfg.updatedAt,
    updatedBy: cfg.updatedBy,
    source: cfg.providers.length ? 'panel' : fallback ? 'env' : 'none',
    envFallback: fallback ? { baseUrl: fallback.provider.baseUrl, model: fallback.provider.models[0].id, protocol: fallback.provider.protocol } : null,
    catalogUrl: cfg.catalogUrl,
    defaultCatalogUrl: env.MODEL_CATALOG_URL ?? '',
    purposes: cfg.purposes,
    providers: cfg.providers.map<ViewProvider>(p => ({ ...p, keys: p.keys.map(({ enc: _enc, ...k }) => ({ ...k, masked: `••••${k.last4}` })) })),
    targets: describeTargets(cfg.providers),
  };
}

export interface SaveInput {
  version: number;
  catalogUrl?: string;
  purposes?: unknown;
  providers: Array<Omit<Provider, 'keys'> & { keys: Array<{ id?: string; label?: string; enabled?: boolean; apiKey?: string }> }>;
}

const bad = (message: string) => new ApiError(400, 'INVALID_CONFIG', message);
function httpsUrl(value: string, what: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw bad(`${what}无效`); }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw bad(`${what}必须是 https`);
  return url.toString().replace(/\/+$/, '');
}

export async function saveConfig(env: Env, input: SaveInput, by: string) {
  const current = await loadConfig(env);
  if (input.version !== current.version) throw new ApiError(409, 'VERSION_CONFLICT', '配置已被其他人修改，请刷新后再保存');
  if (!Array.isArray(input.providers)) throw bad('providers 需要是数组');
  const seen = new Set<string>();
  const providers: Provider[] = [];
  for (const raw of input.providers) {
    const id = String(raw?.id ?? '');
    if (!ID_RE.test(id) || id === 'env') throw bad(`提供商 id「${id}」无效：字母数字开头，可含 - _ .，不超过 64 字`);
    if (seen.has(id)) throw bad(`提供商 id「${id}」重复`);
    seen.add(id);
    if (!PROTOCOLS.includes(raw.protocol)) throw bad(`「${id}」的协议无效`);
    const baseUrl = new URL(httpsUrl(String(raw.baseUrl ?? ''), `「${id}」的 Base URL`));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.headers ?? {})) {
      if (!HEADER_RE.test(k) || RESERVED_HEADER.test(k)) throw bad(`「${id}」的请求头「${k}」不允许（鉴权头与 User-Agent 有专门的设置）`);
      headers[k] = String(v).slice(0, 500);
    }
    const sessionHeader = String(raw.sessionHeader ?? '').trim();
    if (sessionHeader && (!HEADER_RE.test(sessionHeader) || RESERVED_HEADER.test(sessionHeader))) throw bad(`「${id}」的会话请求头名称无效`);
    const userAgent = String(raw.userAgent ?? '').trim();
    if (userAgent.length > 200 || /[\r\n]/.test(userAgent)) throw bad(`「${id}」的 User-Agent 无效`);
    const old = current.providers.find(p => p.id === id);
    const keys: ProviderKey[] = [];
    for (const k of raw.keys ?? []) {
      if (k.apiKey) {
        const plain = String(k.apiKey).trim();
        if (plain.length < 8 || plain.length > 500) throw bad(`「${id}」的 Key 长度不对`);
        keys.push({ id: crypto.randomUUID().slice(0, 8), label: String(k.label ?? '').slice(0, 40), enc: await encryptKey(env, id, plain), last4: plain.slice(-4), enabled: k.enabled !== false, addedAt: new Date().toISOString() });
      } else {
        const prev = old?.keys.find(x => x.id === k.id);
        if (!prev) throw bad(`「${id}」引用了不存在的 Key ${k.id}`);
        keys.push({ ...prev, label: String(k.label ?? prev.label).slice(0, 40), enabled: k.enabled !== false });
      }
    }
    const models: ProviderModel[] = [];
    for (const m of raw.models ?? []) {
      const mid = String(m?.id ?? '').trim();
      if (!MODEL_RE.test(mid)) throw bad(`「${id}」的模型 id「${mid}」无效`);
      if (models.some(x => x.id === mid)) throw bad(`「${id}」的模型「${mid}」重复`);
      const model: ProviderModel = { id: mid, enabled: m.enabled !== false, order: Number.isFinite(m.order) ? Number(m.order) : 1e6 };
      if (m.protocol) {
        if (!PROTOCOLS.includes(m.protocol)) throw bad(`「${id}/${mid}」的协议无效`);
        if (m.protocol !== raw.protocol) model.protocol = m.protocol;
      }
      if (m.baseUrl) {
        const u = httpsUrl(String(m.baseUrl), `「${id}/${mid}」的 Base URL`);
        if (u !== baseUrl.toString().replace(/\/+$/, '')) model.baseUrl = u;
      }
      models.push(model);
    }
    providers.push({ id, name: String(raw.name ?? id).slice(0, 60) || id, catalogId: raw.catalogId ? String(raw.catalogId).slice(0, 64) : null, protocol: raw.protocol, baseUrl: baseUrl.toString().replace(/\/+$/, ''), enabled: raw.enabled !== false, headers, ...(sessionHeader ? { sessionHeader: sessionHeader.toLowerCase() } : {}), ...(userAgent ? { userAgent } : {}), keys, models });
  }
  renumber(providers);
  let catalogUrl = '';
  if (input.catalogUrl) {
    try { catalogUrl = new URL(input.catalogUrl).toString(); } catch { throw bad('模型目录地址无效'); }
    if (!catalogUrl.startsWith('https://')) throw bad('模型目录地址必须是 https');
  }
  const doc = { providers, purposes: normalizePurposes(input.purposes ?? current.purposes), catalogUrl };
  const now = new Date().toISOString();
  const next = current.version + 1;
  const result = current.stored
    ? await env.DB.prepare('UPDATE settings SET value=?, version=?, updated_at=?, updated_by=? WHERE key=? AND version=?').bind(JSON.stringify(doc), next, now, by, KEY, current.version).run()
    : await env.DB.prepare('INSERT OR IGNORE INTO settings(key,value,version,updated_at,updated_by) VALUES (?,?,?,?,?)').bind(KEY, JSON.stringify(doc), next, now, by).run();
  if (!result.meta.changes) throw new ApiError(409, 'VERSION_CONFLICT', '配置已被其他人修改，请刷新后再保存');
  return configView(env);
}

// ---------------------------------------------------------------------------
// Protocol adapters (non-streaming text)
// ---------------------------------------------------------------------------

export interface CallTarget {
  protocol: Protocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  headers: Record<string, string>;
  userAgent?: string;
  /** Header name and value for gateways that route or cache by session. */
  session?: { header: string; id: string };
}

/** Effective endpoint of a configured model: its own overrides, else the provider's. */
export function endpointOf(provider: Pick<Provider, 'protocol' | 'baseUrl'>, model: Pick<ProviderModel, 'protocol' | 'baseUrl'>) {
  return { protocol: model.protocol ?? provider.protocol, baseUrl: model.baseUrl ?? provider.baseUrl };
}
export interface CallInput { system: string; prompt: string; maxTokens: number; timeoutMs: number }

class CallError extends Error { constructor(message: string, readonly status = 0, readonly final = false) { super(message); } }

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    .catch(error => { throw new CallError((error as Error).name === 'TimeoutError' ? `超时（${Math.round(timeoutMs / 1000)} 秒）` : `网络错误：${(error as Error).message}`); });
  const text = await response.text();
  if (!response.ok) throw new CallError(`HTTP ${response.status}：${text.slice(0, 300)}`, response.status);
  try { return JSON.parse(text); } catch { throw new CallError('返回的不是 JSON'); }
}

const joinText = (parts: unknown) => (Array.isArray(parts) ? parts.map(p => (typeof p === 'string' ? p : typeof (p as any)?.text === 'string' ? (p as any).text : '')).join('') : typeof parts === 'string' ? parts : '');

export async function callTarget(target: CallTarget, input: CallInput): Promise<string> {
  // Client identity and session first; the provider's own extra headers may refine them.
  const t = { ...target, headers: { 'user-agent': target.userAgent || DEFAULT_USER_AGENT, ...(target.session ? { [target.session.header]: target.session.id } : {}), ...target.headers } };
  const base = t.baseUrl.replace(/\/+$/, '');
  let text = '';
  switch (t.protocol) {
    case 'openai-chat': {
      const headers = { authorization: `Bearer ${t.apiKey}`, ...t.headers };
      const body: Record<string, unknown> = { model: t.model, messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }], max_tokens: input.maxTokens };
      let out: any;
      try { out = await post(`${base}/chat/completions`, headers, body, input.timeoutMs); }
      catch (error) {
        // Newer OpenAI models only accept max_completion_tokens.
        if (!(error instanceof CallError) || error.status !== 400 || !/max_completion_tokens/.test(error.message)) throw error;
        delete body.max_tokens; body.max_completion_tokens = input.maxTokens;
        out = await post(`${base}/chat/completions`, headers, body, input.timeoutMs);
      }
      text = joinText(out?.choices?.[0]?.message?.content);
      break;
    }
    case 'openai-responses': {
      const out = await post(`${base}/responses`, { authorization: `Bearer ${t.apiKey}`, ...t.headers }, { model: t.model, instructions: input.system, input: input.prompt, max_output_tokens: input.maxTokens }, input.timeoutMs);
      text = typeof out?.output_text === 'string' ? out.output_text : (out?.output ?? []).flatMap((o: any) => o?.content ?? []).map((c: any) => c?.text ?? '').join('');
      break;
    }
    case 'anthropic-messages': {
      const out = await post(`${base}/messages`, { 'x-api-key': t.apiKey, 'anthropic-version': '2023-06-01', ...t.headers }, { model: t.model, max_tokens: input.maxTokens, system: input.system, messages: [{ role: 'user', content: input.prompt }] }, input.timeoutMs);
      if (out?.stop_reason === 'refusal') throw new CallError('模型拒绝了这次请求', 200, true);
      text = (out?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
      break;
    }
    case 'google-generative-ai': {
      const out = await post(`${base}/models/${encodeURIComponent(t.model)}:generateContent`, { 'x-goog-api-key': t.apiKey, ...t.headers }, { systemInstruction: { parts: [{ text: input.system }] }, contents: [{ role: 'user', parts: [{ text: input.prompt }] }], generationConfig: { maxOutputTokens: input.maxTokens } }, input.timeoutMs);
      text = (out?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
      break;
    }
  }
  if (!text.trim()) throw new CallError('模型返回了空内容（可能输出上限太小）');
  return text;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface Attempt { target: string; key: string; ok: boolean; ms: number; error?: string }

/** Is any model callable for this purpose? Used to decide whether to ask at all. */
export async function modelsAvailable(env: Env): Promise<boolean> {
  const cfg = await loadConfig(env);
  return describeTargets(cfg.providers).some(t => t.callable) || (!cfg.providers.length && !!envProvider(env));
}

/**
 * Call the model chain for a purpose: the purpose's own targets (or the global
 * order), each model with each enabled Key in turn, until one answers.
 */
export async function runModel(env: Env, purpose: Purpose, system: string, prompt: string, options: { session?: string } = {}): Promise<{ text: string; target: string; attempts: Attempt[] }> {
  // One id for every call of a job (an import's structure review and layout plan), as gateways ask.
  const session = options.session ?? crypto.randomUUID();
  const cfg = await loadConfig(env);
  const settings = cfg.purposes[purpose];
  const chain: Array<{ id: string; provider: Provider; model: string; protocol: Protocol; baseUrl: string; keys: Array<{ id: string; get: () => Promise<string> }> }> = [];
  if (cfg.providers.length) {
    const all = describeTargets(cfg.providers).filter(t => t.callable);
    const wanted = settings.targets.length ? settings.targets.map(id => all.find(t => t.id === id)).filter((t): t is TargetSummary => !!t) : all;
    for (const t of wanted.length ? wanted : all) {
      const provider = cfg.providers.find(p => p.id === t.providerId)!;
      const model = provider.models.find(m => m.id === t.modelId)!;
      chain.push({ id: t.id, provider, model: t.modelId, ...endpointOf(provider, model), keys: provider.keys.filter(k => k.enabled).map(k => ({ id: k.id, get: () => decryptKey(env, provider.id, k.enc) })) });
    }
  } else {
    const fallback = envProvider(env);
    if (fallback) chain.push({ id: `env/${fallback.provider.models[0].id}`, provider: fallback.provider, model: fallback.provider.models[0].id, protocol: fallback.provider.protocol, baseUrl: fallback.provider.baseUrl, keys: [{ id: 'env', get: async () => fallback.key }] });
  }
  if (!chain.length) throw new ApiError(501, 'LLM_NOT_CONFIGURED', '还没有可用的模型（管理员可在「模型配置」里添加），已使用规则排版');
  const attempts: Attempt[] = [];
  for (const target of chain) {
    for (const key of target.keys) {
      const started = Date.now();
      try {
        const text = await callTarget({
          protocol: target.protocol, baseUrl: target.baseUrl, model: target.model, apiKey: await key.get(), headers: target.provider.headers ?? {},
          userAgent: target.provider.userAgent, session: target.provider.sessionHeader ? { header: target.provider.sessionHeader, id: session } : undefined,
        }, { system, prompt, maxTokens: settings.maxTokens, timeoutMs: settings.timeoutMs });
        attempts.push({ target: target.id, key: key.id, ok: true, ms: Date.now() - started });
        return { text, target: target.id, attempts };
      } catch (error) {
        attempts.push({ target: target.id, key: key.id, ok: false, ms: Date.now() - started, error: (error as Error).message.slice(0, 200) });
        if (error instanceof CallError && error.final) throw new ApiError(422, 'LLM_REJECTED', '模型拒绝了这次请求，已使用规则排版');
      }
    }
  }
  console.warn(JSON.stringify({ event: 'llm_failed', purpose, attempts }));
  throw new ApiError(502, 'LLM_FAILED', `模型暂时不可用（已尝试 ${attempts.length} 次），已使用规则排版`);
}
