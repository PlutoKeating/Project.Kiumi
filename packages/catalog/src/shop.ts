import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ShopProvenance, TemplateIndexEntry, TemplateRecord } from '@kiumi/core';
import { fetchJson, fetchText, HttpError, RateLimiter, sleep } from './http.ts';
import { assetUrl, extractAssetUrls } from './source.ts';
import { catalogPaths, readJson, slugOf, writeJson } from './store.ts';

/**
 * The studio shop ("风格排版") is a separate product from the built-in
 * `/api/templates` corpus. A shop entry points at a public show page; the
 * page embeds a `showInfo` blob whose `show_data_url` is the full show JSON.
 * There is no `matrix` / `renderer_accelerate` pair here: the show data holds
 * the recorded rendered HTML (`_$raHTML`) directly.
 */
export const SHOP_ROOM = '风格排版';
export const SHOP_PAGE_SIZE = 72;

export interface ShopSeller {
  user_sid?: string;
  unique_uid?: string;
  nickname?: string;
  brand_name?: string | null;
  level?: number;
  userpage_url?: string;
  location?: string;
}

export interface ShopShow {
  show_id: number;
  title: string;
  desc?: string;
  cover?: string;
  type?: number;
  type_text?: string;
  version?: number;
  show_url: string;
  edit_url?: string;
  right_access_privilege?: number;
  right_freeshow?: number;
  saved_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ShopGoods {
  show_goods_id: number;
  show_id: number;
  price: number;
  state?: number;
  state_text?: string;
  copy_number?: number;
  collected_number?: number;
  weight?: number;
  created_at?: string;
  updated_at?: string;
  show: ShopShow;
  seller?: ShopSeller;
  template_membership_flag?: number;
  show_type?: number;
}

interface ShopListPage {
  count?: number;
  goodses?: ShopGoods[];
}

export interface ShopShowInfo {
  show_id?: number;
  title?: string;
  type?: number;
  type_text?: string;
  show_data_url?: string;
  show_url?: string;
  cover?: string;
  desc?: string;
}

export interface ShopShowData {
  version?: string;
  title?: string;
  desc?: string;
  cover?: string;
  cubes?: {
    pages?: {
      layers?: {
        _comp?: {
          _$raHTML?: string;
        };
      }[];
    }[];
  }[];
  $appendix?: {
    htmlForPreview?: string;
  };
  [key: string]: unknown;
}

export interface ShopPaths {
  root: string;
  rawGoodses: string;
  rawShows: string;
  records: string;
  goodses: string;
  index: string;
  report: string;
}

export interface ShopCrawlContext {
  origin: string;
  cookie: string;
  limiter: RateLimiter;
  fetchedAt: string;
  rights: string;
}

export interface ShopListOptions {
  dataDir: string;
  origin?: string;
  cookie?: string;
  rps?: number;
  priceScope?: 'all' | 'free' | 'paid';
  showType?: 'paper' | 'tablet';
  pageSize?: number;
  maxPages?: number;
  refresh?: boolean;
  log?: (line: string) => void;
}

export interface ShopListReport {
  startedAt: string;
  finishedAt: string;
  pages: number;
  fetchedPages: number;
  cachedPages: number;
  count: number;
  unique: number;
  paper: number;
  tablet: number;
  free: number;
  paid: number;
  errors: string[];
}

export interface ShopContentOptions {
  dataDir: string;
  cookie: string;
  origin?: string;
  rps?: number;
  concurrency?: number;
  /** `owned` = free items plus the account's purchased items. */
  scope?: 'free' | 'owned' | 'all';
  /** Explicit operator assertion required before `scope: "all"` is accepted. */
  rightsConfirmed?: boolean;
  maxItems?: number;
  force?: boolean;
  showType?: 'paper' | 'tablet';
  log?: (line: string) => void;
}

export interface ShopContentReport {
  startedAt: string;
  finishedAt: string;
  scope: string;
  candidates: number;
  written: number;
  skipped: number;
  failed: number;
  purchased: number;
  errors: { showGoodsId: number; error: string }[];
}

export interface ShopIndexEntry extends TemplateIndexEntry {
  tags?: string[];
  thumbUri?: string;
  price?: number;
  source?: string;
}

export function shopPaths(dataDir: string): ShopPaths {
  const catalog = catalogPaths(dataDir).catalog;
  const root = path.join(catalog, 'shop');
  return {
    root,
    rawGoodses: path.join(root, 'raw', 'goodses'),
    rawShows: path.join(root, 'raw', 'shows'),
    records: path.join(catalog, 'modern'),
    goodses: path.join(root, 'goodses.json'),
    index: path.join(root, 'index.json'),
    report: path.join(root, 'report.json'),
  };
}

export function shopListUrl(
  origin: string,
  page: number,
  options: { pageSize?: number; priceScope?: 'all' | 'free' | 'paid'; showType?: 'paper' | 'tablet' } = {},
): string {
  const params = new URLSearchParams({
    limit: String(Math.min(SHOP_PAGE_SIZE, Math.max(1, options.pageSize ?? SHOP_PAGE_SIZE))),
    page: String(Math.max(0, page)),
    price_scope: options.priceScope ?? 'all',
    showgoods_type: 'paper',
    by_nearest: '1',
    tpl_flag: '0',
    show_type: options.showType ?? 'paper',
  });
  return `${origin}/api/show_goods/goodses?${params.toString()}`;
}

export function shopDetailUrl(origin: string, showGoodsId: number): string {
  return `${origin}/api/show_goods/goodses/${showGoodsId}`;
}

export function shopPurchasedUrl(origin: string, page: number, pageSize = SHOP_PAGE_SIZE): string {
  const params = new URLSearchParams({
    limit: String(Math.min(SHOP_PAGE_SIZE, Math.max(1, pageSize))),
    page: String(Math.max(0, page)),
  });
  return `${origin}/api/show_goods/my/purchased/goodses?${params.toString()}`;
}

/** Read the `injectedData.showInfo` blob without executing page scripts. */
export function parseShowInfo(html: string): ShopShowInfo | null {
  const patterns = [
    /injectedData\.showInfo\s*=\s*JSON\.parse\(\s*decodeURIComponent\(\s*"([^"]+)"\s*\)\s*\)/,
    /showInfo\s*=\s*JSON\.parse\(\s*decodeURIComponent\(\s*"([^"]+)"\s*\)\s*\)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match?.[1]) continue;
    try {
      return JSON.parse(decodeURIComponent(match[1])) as ShopShowInfo;
    } catch {
      return null;
    }
  }
  return null;
}

/** Concatenate the recorded layer HTML in page order; fall back to the preview blob. */
export function htmlFromShowData(data: ShopShowData): string {
  const layers: string[] = [];
  for (const cube of data.cubes ?? []) {
    for (const page of cube.pages ?? []) {
      for (const layer of page.layers ?? []) {
        const html = layer?._comp?._$raHTML;
        if (typeof html === 'string' && html.trim()) layers.push(html);
      }
    }
  }
  if (layers.length) return layers.join('\n');
  const preview = data.$appendix?.htmlForPreview;
  return typeof preview === 'string' ? preview : '';
}

/**
 * Normalise protocol-relative CDN URLs to https. The records are rendered on
 * both http (local dev) and https (production), and `//img.xiumi.us` resolves
 * to http on a local http page, which the CDN rejects.
 */
export function normalizeRemoteProtocols(html: string): string {
  return html
    .replace(/(\b(?:src|href|xlink:href|data-src|poster)\s*=\s*["'])\/\//gi, '$1https://')
    .replace(/url\(\s*(["']?)\/\//gi, 'url($1https://');
}

const ANIMATION = /<(?:animate|animateTransform|animateMotion|animateColor|set)\b/i;

export function normalizeShopRecord(
  good: ShopGoods,
  data: ShopShowData,
  context: ShopCrawlContext,
): TemplateRecord {
  const html = normalizeRemoteProtocols(htmlFromShowData(data));
  const assets = extractAssetUrls(html);
  for (const raw of [good.show.cover, data.cover]) {
    if (typeof raw === 'string' && raw.trim()) assets.add(assetUrl(raw));
  }
  const price = Number(good.price ?? 0);
  const provenance: ShopProvenance = {
    showGoodsId: good.show_goods_id,
    showId: good.show_id,
    price,
    seller: good.seller?.nickname,
    sellerId: good.seller?.user_sid,
    sellerUrl: good.seller?.userpage_url,
    showUrl: good.show.show_url,
    cover: good.show.cover,
    desc: good.show.desc,
    type: good.show.type_text,
    rights: context.rights,
  };
  return {
    atomTplId: `shop:${good.show.type_text ?? 'paper'}/${good.show_goods_id}`,
    templateId: good.show_goods_id,
    displayName: good.show.title || `风格排版 ${good.show_goods_id}`,
    room: SHOP_ROOM,
    category: 'shop-paper',
    accessibility: price === 0 ? 'Free' : 'Paid',
    visibility: 'All',
    featureRequires: [],
    version: good.show.version ?? 5,
    level: String(price),
    orderNum: good.weight,
    createdAt: good.created_at ?? good.show.created_at,
    updatedAt: good.updated_at ?? good.show.updated_at,
    hasSvg: /<svg\b/i.test(html),
    hasAnimation: ANIMATION.test(html),
    byteSize: Buffer.byteLength(html, 'utf8'),
    html,
    matrix: null,
    tplIds: [],
    assetUrls: [...assets].sort(),
    source: `api:show_goods/${good.show.type_text ?? 'paper'}`,
    fetchedAt: context.fetchedAt,
    tags: [SHOP_ROOM, price === 0 ? '免费' : '付费'],
    thumbUri: good.show.cover,
    shop: provenance,
  };
}

export function toShopIndexEntry(record: TemplateRecord): ShopIndexEntry {
  return {
    atomTplId: record.atomTplId,
    displayName: record.displayName,
    room: record.room,
    accessibility: record.accessibility,
    hasSvg: record.hasSvg,
    hasAnimation: record.hasAnimation,
    byteSize: record.byteSize,
    updatedAt: record.updatedAt,
    tags: record.tags,
    thumbUri: record.thumbUri,
    price: record.shop?.price,
    source: record.source,
  };
}

/**
 * The shop list endpoint returns 429 with no Retry-After once the account's
 * request window is exhausted. Retry the same page after a long pause instead
 * of aborting a multi-hour enumeration.
 */
async function fetchShopJson<T>(
  url: string,
  limiter: RateLimiter,
  options: { cookie?: string; retries?: number } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await fetchJson<T>(url, limiter, options);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        await sleep(120_000 + Math.random() * 30_000);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`shop rate limit did not clear after 10 attempts: ${url}`);
}

function showDataUrl(raw: string): string {
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://')) return `https://${raw.slice('http://'.length)}`;
  if (raw.startsWith('/')) return `https://sd.xiumius.cn${raw}`;
  return raw;
}

async function fetchPurchasedIds(origin: string, cookie: string, limiter: RateLimiter): Promise<Set<number>> {
  const ids = new Set<number>();
  let page = 0;
  for (;;) {
    const data = await fetchShopJson<{ count?: number; goodses?: ShopGoods[] }>(
      shopPurchasedUrl(origin, page),
      limiter,
      { cookie, retries: 2 },
    );
    const batch = data.goodses ?? [];
    for (const good of batch) ids.add(good.show_goods_id);
    if (!batch.length || batch.length < SHOP_PAGE_SIZE) break;
    if (typeof data.count === 'number' && ids.size >= data.count) break;
    page++;
  }
  return ids;
}

/**
 * Enumerate the shop list into a compact local snapshot. Pages are cached on
 * disk so a long crawl can resume without re-reading the whole catalogue.
 */
export async function crawlShopList(options: ShopListOptions): Promise<ShopListReport> {
  const startedAt = new Date().toISOString();
  const log = options.log ?? (() => {});
  const origin = options.origin ?? 'https://xiumi.us';
  const limiter = new RateLimiter(options.rps ?? 3);
  const pageSize = Math.min(SHOP_PAGE_SIZE, Math.max(1, options.pageSize ?? SHOP_PAGE_SIZE));
  const paths = shopPaths(options.dataDir);
  await mkdir(paths.rawGoodses, { recursive: true });
  await mkdir(paths.rawShows, { recursive: true });

  const errors: string[] = [];
  const byId = new Map<number, ShopGoods>();
  let count = 0;
  let pages = 0;
  let fetchedPages = 0;
  let cachedPages = 0;

  const totalPages = options.maxPages ? Math.max(0, options.maxPages) : Number.POSITIVE_INFINITY;
  for (let page = 0; page < totalPages; page++) {
    const file = path.join(paths.rawGoodses, `page-${String(page).padStart(5, '0')}.json`);
    let data: ShopListPage | null = null;
    if (!options.refresh) data = await readJson<ShopListPage>(file);
    if (data) {
      cachedPages++;
    } else {
      try {
        data = await fetchShopJson<ShopListPage>(shopListUrl(origin, page, {
          pageSize,
          priceScope: options.priceScope,
          showType: options.showType,
        }), limiter, { cookie: options.cookie, retries: 3 });
        await writeJson(file, data, false);
        fetchedPages++;
      } catch (error) {
        errors.push(`page ${page}: ${(error as Error).message}`);
        log(`page ${page}: FAILED ${(error as Error).message}`);
        break;
      }
    }

    const batch = data.goodses ?? [];
    if (typeof data.count === 'number' && data.count > count) count = data.count;
    for (const good of batch) {
      if (!byId.has(good.show_goods_id)) byId.set(good.show_goods_id, good);
    }
    pages = page + 1;
    if (!batch.length) break;
    if (batch.length < pageSize) break;
    if (count > 0 && byId.size >= count) break;
    if (page % 10 === 0) log(`list page ${page} (${byId.size}/${count || '?'})`);
  }

  const goodses = [...byId.values()];
  await writeJson(paths.goodses, goodses, false);
  const paper = goodses.filter((good) => good.show.type_text === 'paper').length;
  const tablet = goodses.filter((good) => good.show.type_text === 'tablet').length;
  const free = goodses.filter((good) => Number(good.price) === 0).length;
  const report: ShopListReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    pages,
    fetchedPages,
    cachedPages,
    count,
    unique: goodses.length,
    paper,
    tablet,
    free,
    paid: goodses.length - free,
    errors,
  };
  await writeJson(path.join(paths.root, 'list-report.json'), report);
  log(`shop list: ${goodses.length} unique (${paper} paper, ${tablet} tablet, ${free} free)`);
  return report;
}

/** Fetch one shop entry's public show page + recorded show-data JSON. */
export async function fetchShopRecord(
  good: ShopGoods,
  context: ShopCrawlContext,
): Promise<TemplateRecord> {
  const stage = await fetchText(good.show.show_url, context.limiter, {
    cookie: context.cookie,
    retries: 2,
    timeoutMs: 45_000,
  });
  const info = parseShowInfo(stage.text);
  if (!info?.show_data_url) throw new Error('showInfo.show_data_url missing');
  const data = await fetchJson<ShopShowData>(showDataUrl(info.show_data_url), context.limiter, {
    cookie: context.cookie,
    retries: 2,
    timeoutMs: 45_000,
  });
  const record = normalizeShopRecord(good, data, context);
  if (!record.html.trim()) throw new Error('show data has no recorded HTML');
  return record;
}

/** Rebuild the shop index from the records already on disk (crash recovery). */
export async function rebuildShopIndex(dataDir: string): Promise<ShopIndexEntry[]> {
  const paths = shopPaths(dataDir);
  const files = (await readdir(paths.records).catch(() => [] as string[])).filter(
    (file) => /^shop__.+\.json$/.test(file),
  );
  const entries: ShopIndexEntry[] = [];
  for (const file of files) {
    const record = await readJson<TemplateRecord>(path.join(paths.records, file));
    if (record) entries.push(toShopIndexEntry(record));
  }
  entries.sort((a, b) => a.atomTplId.localeCompare(b.atomTplId));
  await writeJson(paths.index, entries, false);
  return entries;
}

/**
 * Fetch recorded HTML for the selected shop entries. Writes one record per
 * item into `catalog/modern/` so the existing SDK, Worker and editor can serve
 * it without a second catalog implementation.
 */
export async function crawlShop(options: ShopContentOptions): Promise<ShopContentReport> {
  const startedAt = new Date().toISOString();
  const log = options.log ?? (() => {});
  const origin = options.origin ?? 'https://xiumi.us';
  const scope = options.scope ?? 'owned';
  if (scope === 'all' && !options.rightsConfirmed) {
    throw new Error(
      'scope "all" copies paid third-party templates; pass rightsConfirmed / --rights-confirmed only after the operator confirms redistribution rights',
    );
  }
  const paths = shopPaths(options.dataDir);
  await mkdir(paths.records, { recursive: true });
  await mkdir(paths.rawShows, { recursive: true });
  const goodses = (await readJson<ShopGoods[]>(paths.goodses)) ?? [];
  if (!goodses.length) throw new Error('shop list is empty; run "kiumi crawl shop-list" first');
  const limiter = new RateLimiter(options.rps ?? 3);
  const purchased = scope === 'owned' ? await fetchPurchasedIds(origin, options.cookie, limiter) : new Set<number>();
  let candidates = goodses.filter((good) => {
    if ((options.showType ?? 'paper') !== good.show.type_text) return false;
    if (scope === 'free') return Number(good.price) === 0;
    if (scope === 'owned') return Number(good.price) === 0 || purchased.has(good.show_goods_id);
    return true;
  });
  if (options.maxItems && options.maxItems > 0) candidates = candidates.slice(0, options.maxItems);

  let existingIndex = (await readJson<ShopIndexEntry[]>(paths.index)) ?? [];
  const recordFiles = (await readdir(paths.records).catch(() => [] as string[])).filter(
    (file) => /^shop__.+\.json$/.test(file),
  );
  if (existingIndex.length < recordFiles.length) existingIndex = await rebuildShopIndex(options.dataDir);
  const indexById = new Map(existingIndex.map((entry) => [entry.atomTplId, entry]));
  const errors: { showGoodsId: number; error: string }[] = [];
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let cursor = 0;
  let done = 0;
  let flushChain: Promise<unknown> = Promise.resolve();
  const flushIndex = (): Promise<unknown> => {
    const snapshot = [...indexById.values()];
    flushChain = flushChain
      .then(() => writeJson(paths.index, snapshot, false))
      .catch(() => undefined);
    return flushChain;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const good = candidates[cursor++];
      if (!good) return;
      const atomTplId = `shop:${good.show.type_text ?? 'paper'}/${good.show_goods_id}`;
      const file = path.join(paths.records, `${slugOf(atomTplId)}.json`);
      try {
        if (!options.force) {
          const existing = await readJson<TemplateRecord>(file);
          if (existing) {
            if (!indexById.has(atomTplId)) indexById.set(atomTplId, toShopIndexEntry(existing));
            skipped++;
            continue;
          }
        }
        const record = await fetchShopRecord(good, {
          origin,
          cookie: options.cookie,
          limiter,
          fetchedAt: new Date().toISOString(),
          rights: scope === 'all' ? 'operator-confirmed' : scope === 'owned' ? 'purchased-or-free' : 'free',
        });
        await writeJson(file, record, false);
        indexById.set(atomTplId, toShopIndexEntry(record));
        written++;
      } catch (error) {
        failed++;
        const message = (error as Error).message;
        errors.push({ showGoodsId: good.show_goods_id, error: message });
        log(`  ${good.show_goods_id}: FAILED ${message}`);
      } finally {
        done++;
        if (done % 25 === 0) {
          log(`shop content ${done}/${candidates.length} written=${written} skipped=${skipped} failed=${failed}`);
        }
        if (done % 1_000 === 0) void flushIndex();
      }
    }
  };

  log(`shop content: ${candidates.length} candidates, scope=${scope}, imported=${purchased.size} purchased`);
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 3) }, () => worker()));
  await flushChain;
  const index = [...indexById.values()].sort((a, b) => a.atomTplId.localeCompare(b.atomTplId));
  await writeJson(paths.index, index, false);
  const report: ShopContentReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    scope,
    candidates: candidates.length,
    written,
    skipped,
    failed,
    purchased: purchased.size,
    errors: errors.slice(0, 200),
  };
  await writeJson(path.join(paths.root, 'content-report.json'), report);
  log(`shop content done: written=${written} skipped=${skipped} failed=${failed} indexed=${index.length}`);
  return report;
}

/**
 * Merge shop entries into the existing modern index and regenerate the
 * pre-counted room groups. Existing entries are preserved; shop entries are
 * replaced by atomTplId, so running this repeatedly is safe.
 */
export async function mergeShopIntoModern(dataDir: string): Promise<{
  shop: number;
  total: number;
  rooms: number;
}> {
  const paths = shopPaths(dataDir);
  const catalog = catalogPaths(dataDir).catalog;
  const shop = (await readJson<ShopIndexEntry[]>(paths.index)) ?? [];
  const shopIds = new Set(shop.map((entry) => entry.atomTplId));
  const modernIndexPath = path.join(catalog, 'modern-index.json');
  const modernIndex = (await readJson<TemplateIndexEntry[]>(modernIndexPath)) ?? [];
  const merged = [
    ...modernIndex.filter((entry) => !entry.atomTplId.startsWith('shop:') && !shopIds.has(entry.atomTplId)),
    ...shop,
  ].sort((a, b) => a.atomTplId.localeCompare(b.atomTplId));
  await writeJson(modernIndexPath, merged, false);

  const modernDirIndexPath = path.join(catalog, 'modern', 'index.json');
  const modernDirIndex = (await readJson<ShopIndexEntry[]>(modernDirIndexPath)) ?? [];
  const mergedDir = [
    ...modernDirIndex.filter((entry) => !entry.atomTplId.startsWith('shop:') && !shopIds.has(entry.atomTplId)),
    ...shop,
  ].sort((a, b) => a.atomTplId.localeCompare(b.atomTplId));
  await writeJson(modernDirIndexPath, mergedDir, false);

  const roomsPath = path.join(catalog, 'modern-rooms.json');
  const existingRooms = (await readJson<{ group: string; count: number }[]>(roomsPath)) ?? [];
  const counts = new Map<string, number>();
  for (const entry of merged) counts.set(entry.room, (counts.get(entry.room) ?? 0) + 1);
  const order = existingRooms.map((room) => room.group).filter((group) => counts.has(group));
  for (const group of counts.keys()) if (!order.includes(group)) order.push(group);
  const rooms = order.map((group) => ({ group, count: counts.get(group) ?? 0 }));
  await writeJson(roomsPath, rooms);

  return { shop: shop.length, total: merged.length, rooms: rooms.length };
}

/** Cover metadata for a future asset pass without loading all 100k records. */
export function shopAssetUrls(records: TemplateRecord[], limit = 0): string[] {
  const urls = new Set<string>();
  for (const record of records) {
    for (const url of record.assetUrls) urls.add(url);
    if (limit > 0 && urls.size >= limit) break;
  }
  return [...urls].sort();
}
