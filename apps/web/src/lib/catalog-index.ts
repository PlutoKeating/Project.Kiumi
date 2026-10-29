import type { TemplateIndexEntry } from '../api.ts';
import { CATALOG_UPDATED } from './catalog-cache.ts';
const CACHE = 'kiumi-catalog-v1';
const KEY = '/__kiumi/catalog-index';
let index: TemplateIndexEntry[] | undefined;
let reading: Promise<TemplateIndexEntry[] | undefined> | undefined;
export function readCatalogIndex() {
  if (index) return Promise.resolve(index);
  return reading ??= (async () => {
    try { const response = await (await caches.open(CACHE)).match(KEY); if (response) index = await response.json(); }
    catch { /* Network lists remain available. */ }
    return index;
  })();
}
export async function saveCatalogIndex(entries: TemplateIndexEntry[]) {
  index = entries;
  await (await caches.open(CACHE)).put(KEY, Response.json(entries));
  window.dispatchEvent(new CustomEvent(CATALOG_UPDATED, {detail:'/api/templates?index-updated'}));
}
