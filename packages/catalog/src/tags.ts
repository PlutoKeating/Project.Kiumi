import path from 'node:path';
import { collectTplIds, normalizeMatrix, tidySkeleton, type TemplateRecord } from '@kiumi/core';
import { extractAssetUrls, skeletonUrl, type HouseFloor } from './source.ts';
import { fetchText, RateLimiter } from './http.ts';
import { catalogPaths, ensureDirs, readJson, slugOf, writeJson } from './store.ts';

export interface TagNode {
  tag_id: number;
  tag_level: number;
  tag_category_text: string;
  tag_name: string;
  childTags?: TagNode[];
}

export interface TagLeaf {
  id: number;
  group: string;
  path: string[];
}

export interface TagCrawlOptions {
  dataDir: string;
  origin?: string;
  cdn?: string;
  cookie?: string;
  category?: string;
  groups?: string[];
  pageSize?: number;
  rps?: number;
  maxItems?: number;
  log?: (line: string) => void;
}

export interface TagCrawlReport {
  category: string;
  leaves: number;
  fetched: number;
  unique: number;
  written: number;
  bytes: number;
  errors: string[];
  missingSkeletons: number;
}

const ANIMATION = /<(?:animate|animateTransform|animateMotion|animateColor|set)\b/i;

/** Depth-first flatten into leaf tags, keeping the top-level group name. */
export function flattenTags(nodes: TagNode[], group = ''): TagLeaf[] {
  const out: TagLeaf[] = [];
  for (const node of nodes) {
    const name = node.tag_name;
    if (name === 'paper-cp_root' || name === 'booklet-cp_root') {
      out.push(...flattenTags(node.childTags ?? [], group));
      continue;
    }
    const currentGroup = group || name;
    const children = node.childTags ?? [];
    if (children.length) out.push(...flattenTags(children, currentGroup));
    else out.push({ id: node.tag_id, group: currentGroup, path: [currentGroup, name] });
  }
  return out;
}

export async function fetchTagTree(
  origin: string,
  category: string,
  cookie: string | undefined,
  limiter: RateLimiter,
): Promise<TagNode[]> {
  const url = `${origin}/api/templates/tags_tree?tag_category=${encodeURIComponent(
    category,
  )}&tag_level_from=2&tag_level_to=0&template=false`;
  const res = await fetch(url, {
    headers: { cookie: cookie ?? '', accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`tags_tree ${res.status}`);
  const body = (await res.json()) as { data?: TagNode[] };
  return body.data ?? [];
}

interface ModernItem {
  template_id?: number;
  atom_tpl_id: string;
  display_name?: string;
  category_text?: string;
  accessibility_text?: string;
  visibility_text?: string;
  feature_requires?: unknown;
  order_num?: number;
  version?: number;
  level?: unknown;
  created_at?: string;
  updated_at?: string;
  matrix?: unknown;
  renderer_accelerate?: string;
  thumb_uri?: string;
  tags?: { tag_name?: string; tag_id?: number }[];
}

function normalizeModern(item: ModernItem, ctx: { group: string; tags: string[]; fetchedAt: string }): TemplateRecord {
  const html = item.renderer_accelerate ?? '';
  const matrix = item.matrix ?? null;
  const tplIds = [...collectTplIds(normalizeMatrix(matrix))];
  const assets = extractAssetUrls(html);
  for (const url of extractAssetUrls(matrix)) assets.add(url);
  return {
    atomTplId: item.atom_tpl_id,
    templateId: item.template_id,
    displayName: item.display_name ?? item.atom_tpl_id,
    room: ctx.group,
    category: item.category_text ?? 'paper-cp',
    accessibility: item.accessibility_text ?? String(item.accessibility_text ?? 'Public'),
    visibility: item.visibility_text,
    featureRequires:
      item.feature_requires && String(item.feature_requires) !== '0'
        ? [String(item.feature_requires)]
        : [],
    orderNum: item.order_num,
    version: item.version,
    level: item.level === undefined ? undefined : String(item.level),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    hasSvg: /<svg\b/i.test(html),
    hasAnimation: ANIMATION.test(html),
    byteSize: Buffer.byteLength(html, 'utf8'),
    html,
    matrix,
    tplIds,
    assetUrls: [...assets].sort(),
    source: 'api:templates/tags',
    fetchedAt: ctx.fetchedAt,
    tags: ctx.tags,
    thumbUri: item.thumb_uri,
  };
}

/**
 * Crawl the live tag taxonomy: every leaf tag is a paginated list endpoint that
 * returns full records (matrix + rendered html). Deduplicates by atom_tpl_id
 * because the same template appears under several tags.
 */
export async function crawlTagCorpus(options: TagCrawlOptions): Promise<TagCrawlReport> {
  const startedAt = new Date().toISOString();
  const log = options.log ?? (() => {});
  const origin = options.origin ?? 'https://xiumi.us';
  const cdn = options.cdn ?? 'https://sd.xiumius.cn';
  const category = options.category ?? 'paper-cp';
  const pageSize = options.pageSize ?? 100;
  const limiter = new RateLimiter(options.rps ?? 3);
  const paths = catalogPaths(options.dataDir);
  await ensureDirs(paths);

  const tree = await fetchTagTree(origin, category, options.cookie, limiter);
  await writeJson(path.join(paths.catalog, 'tags.json'), tree);
  const leaves = flattenTags(tree).filter(
    (leaf) => !options.groups?.length || options.groups.includes(leaf.group),
  );
  log(`tags: ${leaves.length} leaves in ${category}`);

  const records = new Map<string, TemplateRecord>();
  const errors: string[] = [];
  let fetched = 0;

  for (const leaf of leaves) {
    let offset = 0;
    for (;;) {
      const url =
        `${origin}/api/templates?tag_ids=${leaf.id}&tag_category=${encodeURIComponent(category)}` +
        `&match_level=default&template_category=${encodeURIComponent(category)}` +
        `&limit=${pageSize}&offset=${offset}`;
      let batch: ModernItem[] = [];
      try {
        const res = await fetch(url, { headers: { cookie: options.cookie ?? '', accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data?: { templates?: ModernItem[]; count?: number } };
        batch = body.data?.templates ?? [];
        fetched += batch.length;
        if (!batch.length) break;
        for (const item of batch) {
          const existing = records.get(item.atom_tpl_id);
          if (existing) {
            existing.tags = [...new Set([...(existing.tags ?? []), ...leaf.path])];
            continue;
          }
          records.set(
            item.atom_tpl_id,
            normalizeModern(item, { group: leaf.group, tags: leaf.path, fetchedAt: startedAt }),
          );
          if (options.maxItems && records.size >= options.maxItems) break;
        }
      } catch (error) {
        errors.push(`${leaf.path.join('/')} offset=${offset}: ${(error as Error).message}`);
        break;
      }
      log(`  ${leaf.path.join(' / ')} +${batch.length} (unique ${records.size})`);
      if (options.maxItems && records.size >= options.maxItems) break;
      if (batch.length < pageSize) break;
      offset += pageSize;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (options.maxItems && records.size >= options.maxItems) {
      log(`reached maxItems=${options.maxItems}, stopping`);
      break;
    }
  }

  // Persist records and a committed index.
  const modernDir = path.join(paths.catalog, 'modern');
  const index: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const record of records.values()) {
    await writeJson(path.join(modernDir, `${slugOf(record.atomTplId)}.json`), record, false);
    bytes += record.byteSize;
    index.push({
      atomTplId: record.atomTplId,
      displayName: record.displayName,
      room: record.room,
      tags: record.tags,
      accessibility: record.accessibility,
      hasSvg: record.hasSvg,
      hasAnimation: record.hasAnimation,
      byteSize: record.byteSize,
      updatedAt: record.updatedAt,
      thumbUri: record.thumbUri,
    });
  }
  index.sort((a, b) => String(a.atomTplId).localeCompare(String(b.atomTplId)));
  await writeJson(path.join(modernDir, 'index.json'), index);
  // Committed copy: the payloads themselves stay out of git.
  await writeJson(path.join(paths.catalog, 'modern-index.json'), index, false);

  // Fill skeletons the base pack does not cover.
  const packPath = paths.pack;
  const skeletons = (await readJson<Record<string, string>>(packPath)) ?? {};
  const missing = new Set<string>();
  for (const record of records.values()) {
    for (const tplId of record.tplIds) if (!skeletons[tplId]) missing.add(tplId);
  }
  let added = 0;
  if (missing.size && options.cookie !== undefined) {
    for (const tplId of missing) {
      try {
        const { text } = await fetchText(skeletonUrl(cdn, tplId), limiter, { retries: 1 });
        skeletons[tplId] = tidySkeleton(text.trim());
        added++;
      } catch {
        /* optional */
      }
    }
    await writeJson(packPath, skeletons);
  }

  return {
    category,
    leaves: leaves.length,
    fetched,
    unique: records.size,
    written: index.length,
    bytes,
    errors,
    missingSkeletons: Math.max(0, missing.size - added),
  };
}

/** Load the modern tag corpus index (metadata only). */
export async function loadModernIndex(dataDir: string): Promise<Record<string, unknown>[]> {
  const paths = catalogPaths(dataDir);
  return (
    (await readJson<Record<string, unknown>[]>(path.join(paths.catalog, 'modern-index.json'))) ??
    (await readJson<Record<string, unknown>[]>(path.join(paths.catalog, 'modern', 'index.json'))) ??
    []
  );
}
