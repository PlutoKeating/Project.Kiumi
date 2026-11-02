import { cachedCatalog, catalogStorageAvailable } from './catalog-cache.ts';
import { saveCatalogIndex } from './catalog-index.ts';
import { fetchTemplate, type TemplateIndexEntry } from '../api.ts';

let running = false;
let paused = false;
let stopped = false;
export const SYNC_STATUS = 'kiumi:catalog-sync';
export function pauseCatalogSync(value: boolean) { paused = value; }
export function stopCatalogSync() { stopped = true; paused = false; }
const report = (text: string) => window.dispatchEvent(new CustomEvent(SYNC_STATUS, {detail:text}));

/**
 * Explicit, resumable catalog download. It is no longer started on page load:
 * the app caches a template when its card is opened or inserted, and this
 * runs only when the user asks for the full offline copy.
 */
export async function syncCatalog(options: { limit?: number } = {}) {
  if (running) return;
  running = true;
  stopped = false;
  let count = 0;
  try {
    while (paused || document.hidden || !navigator.onLine) await new Promise(resolve => setTimeout(resolve, 1000));
    report('正在同步模板目录…');
    const index = await cachedCatalog<TemplateIndexEntry[]>('/api/catalog/index', true);
    await saveCatalogIndex(index);
    // Shop records are large and image-heavy; caching all of them in the
    // background competes with the first card renders. They load on demand.
    const entries = [...new Map(index.map(item => [item.atomTplId, item])).values()]
      .filter(item => !item.atomTplId.startsWith('shop:'));
    const total = entries.length;
    const limit = options.limit && options.limit > 0 ? options.limit : total;
    for (const entry of entries) {
        if (stopped) break;
        if (count >= limit) break;
        while (paused || document.hidden || !navigator.onLine) {
          if (stopped) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (stopped) break;
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
        report(`本地模板同步：${++count} / ${total}`);
    }
    report(stopped ? `模板同步已停止（已缓存 ${count} 个）` : `模板已缓存到本机（${count} 个）`);
  } catch { report('模板后台同步暂不可用，已缓存内容可继续使用'); }
  finally { running = false; }
}
