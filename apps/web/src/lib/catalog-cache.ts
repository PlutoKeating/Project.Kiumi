/** Public catalog only: never put sessions, drafts or team uploads here. */
const CACHE = 'kiumi-catalog-v1';
let persistent = true;
export const catalogStorageAvailable = () => persistent;
const memory = new Map<string, unknown>();
const checked = new Set<string>();
const pending = new Map<string, Promise<unknown>>();
export const CATALOG_UPDATED = 'kiumi:catalog-updated';

export async function cachedCatalog<T>(path: string, revalidate = false): Promise<T> {
  const refresh = (): Promise<T> => {
    const running = pending.get(path);
    if (running) return running as Promise<T>;
    const task = (async () => {
      let saved: Response | undefined;
      try { saved = await (await caches.open(CACHE)).match(path); } catch { /* Memory/network fallback. */ }
      const etag = saved?.headers.get('etag');
      const response = await fetch(path, { cache: 'no-cache', headers: etag ? {'if-none-match':etag} : {} });
      if (response.status === 304 && saved) {
        const payload = await saved.json();
        if (memory.size >= 200) memory.delete(memory.keys().next().value!);
        memory.set(path, payload.data); checked.add(path);
        return payload.data as T;
      }
      if (!response.ok) throw new Error(`模板加载失败 (${response.status})`);
      const payload = await response.clone().json();
      if (payload.ok !== true) throw new Error(payload.error?.message || '模板响应无效');
      const previous = memory.get(path);
      if (memory.size >= 200) memory.delete(memory.keys().next().value!);
      memory.set(path, payload.data);
      checked.add(path);
      try { await (await caches.open(CACHE)).put(path, response); } catch { persistent = false; /* Quota/private mode: memory remains usable. */ }
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(payload.data)) {
        window.dispatchEvent(new CustomEvent(CATALOG_UPDATED, { detail: path }));
      }
      return payload.data as T;
    })().finally(() => pending.delete(path));
    pending.set(path, task);
    return task;
  };
  if (!memory.has(path)) {
    try {
      const saved = await (await caches.open(CACHE)).match(path);
      if (saved) {
        const payload = await saved.json();
        if (payload.ok === true) {
          if (memory.size >= 200) memory.delete(memory.keys().next().value!);
          memory.set(path, payload.data);
        }
      }
    } catch { /* A corrupt or unavailable cache falls back to the network. */ }
  }
  if (revalidate) return refresh();
  if (memory.has(path)) {
    if (!checked.has(path)) { checked.add(path); void refresh().catch(() => checked.delete(path)); }
    return memory.get(path) as T;
  }
  return refresh();
}
