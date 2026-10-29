import { tplIdToPath } from '@kiumi/core';

export const DEFAULT_ORIGIN = 'https://xiumi.us';
export const DEFAULT_CDN = 'https://sd.xiumius.cn';
export const DEFAULT_ASSET_HOST = 'https://statics.xiumi.us';

export interface HouseFloor {
  house: string;
  floor: string;
}

/** House/floor combinations confirmed reachable without authentication. */
export const PUBLIC_SOURCES: HouseFloor[] = [
  { house: 'paper', floor: 'comp' },
  { house: 'paper', floor: 'page' },
  { house: 'booklet', floor: 'comp' },
  { house: 'booklet', floor: 'page' },
];

export function roomsUrl(origin: string, source: HouseFloor): string {
  return `${origin}/api/templates/${source.house}/${source.floor}/rooms`;
}

export function roomUrl(origin: string, source: HouseFloor, tag: string): string {
  return `${origin}/api/templates/${source.house}/${source.floor}/rooms/${encodeURIComponent(tag)}`;
}

/** AngularJS content pack with every skeleton inlined. */
export function packUrl(origin: string, house: string): string {
  return `${origin}/template/v5/${house}/comp/ng-tpl.js?host=xiumi.us`;
}

/** Individual skeleton, used to fill gaps the pack does not cover. */
export function skeletonUrl(cdn: string, tplId: string): string {
  return `${cdn}/tpls/${tplIdToPath(tplId)}.html`;
}

export function assetUrl(raw: string, assetHost = DEFAULT_ASSET_HOST): string {
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `${assetHost}${raw}`;
  // Upgrade plain http so every asset costs one request instead of a redirect,
  // and so http/https variants of the same file collapse into one entry.
  if (raw.startsWith('http://')) return `https://${raw.slice('http://'.length)}`;
  return raw;
}

/** Extract every remote asset reference from a record payload. */
export function extractAssetUrls(payload: unknown): Set<string> {
  const out = new Set<string>();
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const pattern =
    /(?:https?:)?\/\/(?:statics|res|img|img01|mmbiz)[a-z0-9.\-]*\.(?:xiumi\.us|xiumius\.cn|qpic\.cn|qq\.com)\/[^"'()\\\s]+?\.(?:png|jpe?g|gif|svg|webp|bmp)/gi;
  for (const match of text.matchAll(pattern)) {
    const url = assetUrl(match[0]);
    out.add(url.replace(/\\$/, ''));
  }
  return out;
}

/** Houses worth probing once an authenticated cookie is available. */
export const MEMBER_HOUSES = [
  'paper',
  'booklet',
  'svg',
  'tpl',
  'pro',
  'vip',
  'atom',
  'sticker',
  'element',
  'template',
  'animation',
];

/** Floors used by the member content packs. */
export const MEMBER_FLOORS = ['comp', 'page', 'v5', 'svg'];

/** Fragment library roots seen in the editor bundle. */
export const FRAGMENT_ROOTS = ['svg', 'paper', 'comp', 'tpl', 'fragment'];
