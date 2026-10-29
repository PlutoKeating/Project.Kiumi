import { cachedCatalog, catalogStorageAvailable } from './catalog-cache.ts';
import { saveCatalogIndex } from './catalog-index.ts';
import { fetchTemplate, type TemplateIndexEntry } from '../api.ts';

let running = false;
let paused = false;
export const SYNC_STATUS = 'kiumi:catalog-sync';
export function pauseCatalogSync(value: boolean) { paused = value; }
const report = (text: string) => window.dispatchEvent(new CustomEvent(SYNC_STATUS, {detail:text}));

/** Gradually populate the complete catalog, without blocking visible cards or editing. */
export async function syncCatalog() {
  if (running) return;
  running = true;
  let count = 0;
  try {
    while (paused || document.hidden || !navigator.onLine) await new Promise(resolve => setTimeout(resolve, 1000));
    report('正在同步模板目录…');
    const index = await cachedCatalog<TemplateIndexEntry[]>('/api/catalog/index', true);
    await saveCatalogIndex(index);
    const entries = [...new Map(index.map(item => [item.atomTplId, item])).values()];
    for (const entry of entries) {
        while (paused || document.hidden || !navigator.onLine) await new Promise(resolve => setTimeout(resolve, 1000));
        // Leave network and main-thread time for interaction; only one background record at a time.
        await new Promise(resolve => setTimeout(resolve, 150));
        if (count % 50 === 0) {
          const storage = await navigator.storage?.estimate();
          if (storage?.quota && (storage.usage || 0) > storage.quota * 0.8) {
            report('本地空间不足，模板同步已暂停'); return;
          }
        }
        await fetchTemplate(entry.atomTplId);
        if (!catalogStorageAvailable()) { report('浏览器无法持久缓存，后台同步已暂停'); return; }
        report(`本地模板同步：${++count} 个`);
    }
    report(`模板已缓存到本机（${count} 个）`);
  } catch { report('模板后台同步暂不可用，已缓存内容可继续使用'); }
  finally { running = false; }
}
