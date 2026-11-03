/**
 * Model catalog in the models.dev schema (`{ [providerId]: { name, api, npm, doc, models } }`).
 *
 * The source URL is configuration, never code: the admin panel's `catalogUrl`,
 * else the `MODEL_CATALOG_URL` deployment variable. The slimmed catalog (about
 * 2 MB, too large for one D1 value) lives in the Workers Cache API for a day
 * plus module memory; the panel's refresh button forces a fetch.
 *
 * models.dev describes AI-SDK packages, not HTTP protocols, so the protocol is
 * inferred from the package name; unknown packages stay `null` and the admin
 * picks one. Base URLs come only from the catalog's `api` field or the admin.
 */
import type { Protocol } from './llm.js';

export interface CatalogModel {
  id: string;
  name: string;
  family: string | null;
  status: string | null;
  released: string | null;
  updated: string | null;
  context: number | null;
  output: number | null;
  costIn: number | null;
  costOut: number | null;
  reasoning: boolean;
  openWeights: boolean;
  images: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  doc: string | null;
  baseUrl: string | null;
  npm: string;
  protocol: Protocol | null;
  models: CatalogModel[];
}

export interface CatalogDoc {
  source: string;
  fetchedAt: string;
  providers: CatalogProvider[];
}

/** AI-SDK package -> wire protocol. Packages outside this list speak something else. */
const NPM_PROTOCOLS: Record<string, Protocol> = {
  '@ai-sdk/openai': 'openai-chat',
  '@ai-sdk/openai-compatible': 'openai-chat',
  '@openrouter/ai-sdk-provider': 'openai-chat',
  '@ai-sdk/xai': 'openai-chat',
  '@ai-sdk/groq': 'openai-chat',
  '@ai-sdk/deepinfra': 'openai-chat',
  '@ai-sdk/togetherai': 'openai-chat',
  '@ai-sdk/cerebras': 'openai-chat',
  '@ai-sdk/perplexity': 'openai-chat',
  '@ai-sdk/mistral': 'openai-chat',
  '@ai-sdk/anthropic': 'anthropic-messages',
  '@ai-sdk/google': 'google-generative-ai',
};

const TTL_MS = 24 * 60 * 60 * 1000;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Keep what the panel shows; sorted by name, models by id. Pure, for tests. */
export function slimCatalog(raw: unknown): CatalogProvider[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('目录格式不对：应为 { 提供商id: {...} }');
  const out: CatalogProvider[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    if (!value || typeof value !== 'object') continue;
    const npm = str(value.npm) ?? '';
    const models: CatalogModel[] = Object.entries((value.models ?? {}) as Record<string, any>).map(([mid, m]) => ({
      id: str(m?.id) ?? mid,
      name: str(m?.name) ?? mid,
      family: str(m?.family),
      status: str(m?.status),
      released: str(m?.release_date),
      updated: str(m?.last_updated),
      context: num(m?.limit?.context),
      output: num(m?.limit?.output),
      costIn: num(m?.cost?.input),
      costOut: num(m?.cost?.output),
      reasoning: m?.reasoning === true,
      openWeights: m?.open_weights === true,
      images: Array.isArray(m?.modalities?.input) && m.modalities.input.includes('image'),
    })).filter(m => m.id).sort((a, b) => a.id.localeCompare(b.id));
    out.push({ id: str(value.id) ?? key, name: str(value.name) ?? key, doc: str(value.doc), baseUrl: str(value.api), npm, protocol: NPM_PROTOCOLS[npm] ?? null, models });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

let memory: CatalogDoc | null = null;
const cacheKey = (source: string) => new Request(`https://catalog.cache.kiumi/${encodeURIComponent(source)}`);
const cacheStore = (): Cache | null => (typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default ?? null : null);

export async function getCatalog(source: string | null, options: { refresh?: boolean } = {}): Promise<{ doc: CatalogDoc | null; error?: string }> {
  if (!source) return { doc: null, error: '还没有设置模型目录地址（在「设置」里填写，或部署变量 MODEL_CATALOG_URL）' };
  const fresh = (d: CatalogDoc | null) => !!d && d.source === source && Date.now() - Date.parse(d.fetchedAt) < TTL_MS;
  if (!options.refresh && fresh(memory)) return { doc: memory };
  const cache = cacheStore();
  if (!options.refresh && cache) {
    const hit = await cache.match(cacheKey(source)).catch(() => undefined);
    if (hit) {
      const doc = await hit.json().catch(() => null) as CatalogDoc | null;
      if (fresh(doc)) return { doc: (memory = doc) };
    }
  }
  try {
    const response = await fetch(source, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`目录返回 HTTP ${response.status}`);
    const doc: CatalogDoc = { source, fetchedAt: new Date().toISOString(), providers: slimCatalog(await response.json()) };
    memory = doc;
    await cache?.put(cacheKey(source), new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${TTL_MS / 1000}` } })).catch(() => {});
    return { doc };
  } catch (error) {
    // Keep serving the last catalog we had.
    return { doc: memory?.source === source ? memory : null, error: `目录获取失败：${(error as Error).message}` };
  }
}

export function _resetCatalog() { memory = null; }
