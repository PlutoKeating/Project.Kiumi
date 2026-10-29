import type { RoomInfo, TemplateIndexEntry, TemplateRecord } from '@kiumi/core';
import { collectTplIds, normalizeMatrix } from '@kiumi/core';
import { extractAssetUrls, type HouseFloor } from './source.ts';

/** Shape of one upstream `data.items[]` entry. */
export interface RawTemplateItem {
  template_id?: number;
  atom_tpl_id: string;
  display_name?: string;
  creator_id?: number;
  category?: string;
  accessibility?: string;
  visibility?: string;
  feature_requires?: string[];
  order_num?: number;
  version?: number;
  level?: string;
  created_at?: string;
  updated_at?: string;
  matrix?: unknown;
  renderer_accelerate?: string;
}

export interface RawRoom {
  tag: string;
  name?: string;
  desc?: string;
  order_num?: string | number;
  items?: RawTemplateItem[];
}

export interface NormalizeContext {
  source: HouseFloor;
  room: string;
  fetchedAt: string;
}

const ANIMATION_PATTERN = /<(?:animate|animateTransform|animateMotion|animateColor|set)\b/i;
const SVG_PATTERN = /<svg\b/i;

/** Convert one raw item into the stored record shape. */
export function normalizeTemplate(item: RawTemplateItem, ctx: NormalizeContext): TemplateRecord {
  const html = item.renderer_accelerate ?? '';
  const matrix = item.matrix ?? null;
  const tplIds = [...collectTplIds(normalizeMatrix(matrix))];
  const assets = extractAssetUrls(html);
  for (const url of extractAssetUrls(matrix)) assets.add(url);

  return {
    atomTplId: item.atom_tpl_id,
    templateId: item.template_id,
    displayName: item.display_name ?? item.atom_tpl_id,
    room: ctx.room,
    category: item.category ?? ctx.room.split(':')[0],
    accessibility: item.accessibility ?? 'Public',
    visibility: item.visibility,
    creatorId: item.creator_id,
    version: item.version,
    level: item.level,
    featureRequires: item.feature_requires ?? [],
    orderNum: item.order_num,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    hasSvg: SVG_PATTERN.test(html),
    hasAnimation: ANIMATION_PATTERN.test(html),
    byteSize: Buffer.byteLength(html, 'utf8'),
    html,
    matrix,
    tplIds,
    assetUrls: [...assets].sort(),
    source: `api:templates/${ctx.source.house}/${ctx.source.floor}`,
    fetchedAt: ctx.fetchedAt,
  };
}

export function normalizeRoom(raw: RawRoom, source: HouseFloor, count: number): RoomInfo {
  return {
    tag: raw.tag,
    name: raw.name ?? raw.tag,
    order: Number(raw.order_num ?? 0) || 0,
    house: source.house,
    floor: source.floor,
    count,
  };
}

export function toIndexEntry(record: TemplateRecord): TemplateIndexEntry {
  return {
    atomTplId: record.atomTplId,
    displayName: record.displayName,
    room: record.room,
    accessibility: record.accessibility,
    hasSvg: record.hasSvg,
    hasAnimation: record.hasAnimation,
    byteSize: record.byteSize,
    updatedAt: record.updatedAt,
  };
}

/** Rooms whose entries are just a "new arrivals" window over other rooms. */
export function isAggregateRoom(tag: string): boolean {
  return tag.endsWith(':recent');
}
