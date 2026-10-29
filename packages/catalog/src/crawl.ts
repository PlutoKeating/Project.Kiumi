import path from 'node:path';
import { parseTemplatePack, tidySkeleton } from '@kiumi/core';
import type { RoomInfo, TemplateIndexEntry, TemplateRecord } from '@kiumi/core';
import { collectUrls, mirrorAssets, type AssetManifest } from './assets.ts';
import { fetchJson, fetchText, RateLimiter } from './http.ts';
import {
  isAggregateRoom,
  normalizeRoom,
  normalizeTemplate,
  toIndexEntry,
  type RawRoom,
  type RawTemplateItem,
} from './normalize.ts';
import {
  assetUrl,
  DEFAULT_CDN,
  DEFAULT_ORIGIN,
  PUBLIC_SOURCES,
  packUrl,
  roomUrl,
  roomsUrl,
  skeletonUrl,
  type HouseFloor,
} from './source.ts';
import { catalogPaths, ensureDirs, readJson, slugOf, writeJson } from './store.ts';

export interface CrawlOptions {
  dataDir: string;
  origin?: string;
  cdn?: string;
  /** Requests per second across the whole crawl. */
  rps?: number;
  /** Raw Cookie header for member-only houses. Never persisted. */
  cookie?: string;
  sources?: HouseFloor[];
  includeObsolete?: boolean;
  fetchMissingSkeletons?: boolean;
  log?: (line: string) => void;
}

export interface SourceReport {
  house: string;
  floor: string;
  rooms: number;
  templates: number;
  errors: string[];
}

export interface CrawlReport {
  startedAt: string;
  finishedAt: string;
  templates: number;
  rooms: number;
  skeletons: number;
  sources: SourceReport[];
  missingSkeletons: string[];
  failedSkeletons: { tplId: string; error: string }[];
  skippedRooms: { house: string; floor: string; tag: string; reason: string }[];
}

export async function crawlCatalog(options: CrawlOptions): Promise<CrawlReport> {
  const startedAt = new Date().toISOString();
  const log = options.log ?? (() => {});
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const cdn = options.cdn ?? DEFAULT_CDN;
  const limiter = new RateLimiter(options.rps ?? 2);
  const sources = options.sources ?? PUBLIC_SOURCES;
  const includeObsolete = options.includeObsolete ?? true;
  const paths = catalogPaths(options.dataDir);
  await ensureDirs(paths);

  const fetchedAt = startedAt;
  const rooms: RoomInfo[] = [];
  const records = new Map<string, { record: TemplateRecord; priority: number }>();
  const sourceReports: SourceReport[] = [];
  const skippedRooms: CrawlReport['skippedRooms'] = [];

  for (const source of sources) {
    const report: SourceReport = {
      house: source.house,
      floor: source.floor,
      rooms: 0,
      templates: 0,
      errors: [],
    };
    sourceReports.push(report);
    log(`rooms ${source.house}/${source.floor}`);

    let list: RawRoom[] = [];
    try {
      const data = await fetchJson<{ rooms?: RawRoom[] }>(roomsUrl(origin, source), limiter, {
        cookie: options.cookie,
      });
      list = data.rooms ?? [];
      await writeJson(path.join(paths.raw, 'rooms', `${source.house}-${source.floor}.json`), data);
    } catch (error) {
      report.errors.push((error as Error).message);
      continue;
    }

    for (const rawRoom of list) {
      try {
        const room = await fetchJson<RawRoom>(roomUrl(origin, source, rawRoom.tag), limiter, {
          cookie: options.cookie,
        });
        const items = (room.items ?? []) as RawTemplateItem[];
        await writeJson(
          path.join(paths.raw, 'rooms', `${source.house}-${source.floor}-${slugOf(rawRoom.tag)}.json`),
          room,
        );
        rooms.push(normalizeRoom({ ...rawRoom, items }, source, items.length));
        report.rooms++;

        for (const item of items) {
          if (!includeObsolete && item.accessibility === 'Obsolete') continue;
          const record = normalizeTemplate(item, { source, room: rawRoom.tag, fetchedAt });
          const priority = isAggregateRoom(rawRoom.tag) ? 1 : 0;
          const previous = records.get(record.atomTplId);
          if (!previous || priority < previous.priority) {
            records.set(record.atomTplId, { record, priority });
          }
        }
        report.templates = records.size;
        log(`  ${rawRoom.tag}: ${items.length} items`);
      } catch (error) {
        const reason = (error as Error).message;
        report.errors.push(`${rawRoom.tag}: ${reason}`);
        skippedRooms.push({ house: source.house, floor: source.floor, tag: rawRoom.tag, reason });
        log(`  ${rawRoom.tag}: SKIPPED (${reason})`);
      }
    }
  }

  // Skeleton packs: one per house, then fill gaps from the CDN.
  const skeletons: Record<string, string> = {};
  const houses = [...new Set(sources.map((source) => source.house))];
  for (const house of houses) {
    try {
      const { text } = await fetchText(packUrl(origin, house), limiter, { cookie: options.cookie });
      const parsed = parseTemplatePack(text);
      for (const [tplId, entry] of parsed) skeletons[tplId] = tidySkeleton(entry.html);
      log(`pack ${house}: ${parsed.size} skeletons`);
    } catch (error) {
      log(`pack ${house}: FAILED ${(error as Error).message}`);
    }
  }

  const missingSkeletons: string[] = [];
  const failedSkeletons: { tplId: string; error: string }[] = [];
  if (options.fetchMissingSkeletons !== false) {
    const needed = new Set<string>();
    for (const { record } of records.values()) {
      for (const tplId of record.tplIds) if (!skeletons[tplId]) needed.add(tplId);
    }
    const queue = [...needed].sort();
    const concurrency = 3;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        const tplId = queue[index];
        if (!tplId) return;
        try {
          const { text } = await fetchText(skeletonUrl(cdn, tplId), limiter, {
            cookie: options.cookie,
            retries: 2,
          });
          skeletons[tplId] = tidySkeleton(text.trim());
        } catch (error) {
          failedSkeletons.push({ tplId, error: (error as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    missingSkeletons.push(...failedSkeletons.map((item) => item.tplId));
    log(`skeletons: ${Object.keys(skeletons).length} total, ${needed.size} fetched from CDN`);
  }

  // Persist catalog.
  const index: TemplateIndexEntry[] = [];
  for (const { record } of records.values()) {
    await writeJson(
      path.join(paths.templates, `${slugOf(record.atomTplId)}.json`),
      record,
      false,
    );
    index.push(toIndexEntry(record));
  }
  index.sort((a, b) => a.room.localeCompare(b.room) || a.atomTplId.localeCompare(b.atomTplId));
  rooms.sort((a, b) => a.order - b.order);

  await writeJson(paths.index, index);
  await writeJson(paths.rooms, rooms);
  await writeJson(paths.pack, skeletons);

  const report: CrawlReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    templates: records.size,
    rooms: rooms.length,
    skeletons: Object.keys(skeletons).length,
    sources: sourceReports,
    missingSkeletons,
    failedSkeletons,
    skippedRooms,
  };
  await writeJson(paths.report, report);
  return report;
}

export interface CrawlAssetsOptions {
  dataDir: string;
  concurrency?: number;
  rps?: number;
  limit?: number;
  cookie?: string;
  log?: (line: string) => void;
}

export async function crawlAssets(options: CrawlAssetsOptions): Promise<{
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
}> {
  const paths = catalogPaths(options.dataDir);
  const index = await readJson<TemplateIndexEntry[]>(paths.index);
  if (!index) throw new Error('catalog not found; run "kiumi crawl templates" first');

  const records: TemplateRecord[] = [];
  for (const entry of index) {
    const record = await readJson<TemplateRecord>(
      path.join(paths.templates, `${slugOf(entry.atomTplId)}.json`),
    );
    if (record) records.push(record);
  }

  const urls = collectUrls(records).slice(0, options.limit && options.limit > 0 ? options.limit : undefined);
  const rawExisting = (await readJson<AssetManifest>(paths.assetsManifest)) ?? {};
  // Collapse http/https variants (and their redirect cost) into one key.
  const existing: AssetManifest = {};
  for (const [url, entry] of Object.entries(rawExisting)) existing[assetUrl(url)] = entry;
  let flushChain: Promise<unknown> = Promise.resolve();
  const result = await mirrorAssets(urls, {
    assetsDir: paths.assets,
    concurrency: options.concurrency ?? 4,
    rps: options.rps ?? 4,
    existing,
    cookie: options.cookie,
    onProgress: (done, total, _url, snapshot) => {
      if (done % 25 === 0 || done === total) options.log?.(`assets ${done}/${total}`);
      // Flush periodically so an interrupted mirror still leaves a usable manifest.
      if (done % 100 === 0) {
        const payload = structuredClone(snapshot);
        flushChain = flushChain
          .then(() => writeJson(paths.assetsManifest, payload))
          .catch(() => undefined);
      }
    },
  });
  await writeJson(paths.assetsManifest, result.manifest);
  return {
    total: urls.length,
    downloaded: result.downloaded,
    skipped: result.skipped,
    failed: result.failed.length,
  };
}
