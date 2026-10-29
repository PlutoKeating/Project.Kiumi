import { useEffect, useState } from 'react';
import { useStore } from '../store.ts';

interface AssetItem {
  url: string;
  path: string;
  bytes: number;
}

export function AssetsPanel() {
  const addImageBlock = useStore((state) => state.addImageBlock);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ limit: '90' });
    if (query) params.set('q', query);
    fetch(`/api/assets?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        setItems(payload.data ?? []);
        setTotal(payload.meta?.total ?? 0);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [query]);

  return (
    <section className="w-[360px] shrink-0 bg-ink-700 text-mist-100 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-white/10 text-[13px]">图片素材</div>
      <div className="px-3 py-2 border-b border-white/10">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按文件名搜索"
          className="w-full bg-ink-800 border border-white/10 rounded px-2 py-1.5 text-[12px] placeholder:text-mist-200/30 focus:outline-none focus:border-accent-400"
        />
      </div>
      <div className="px-3 py-1.5 text-[11px] text-mist-200/50">
        {loading ? '加载中…' : `已镜像 ${total} 个`}
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4 grid grid-cols-3 gap-2 content-start">
        {items.map((item) => (
          <button
            key={item.url}
            onClick={() => addImageBlock(item.url)}
            title={item.url}
            className="aspect-square rounded border border-white/10 bg-white/5 overflow-hidden hover:border-accent-400"
          >
            <img
              src={`/assets/${item.path}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </button>
        ))}
        {!loading && items.length === 0 && (
          <p className="col-span-3 text-[12px] text-mist-200/40 py-6 text-center">
            还没有镜像素材，运行 <code>pnpm kiumi crawl assets</code>
          </p>
        )}
      </div>
    </section>
  );
}
