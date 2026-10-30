import { useEffect, useState } from 'react';
import { PanelState } from './PanelState.tsx';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ limit: '90' });
    if (query) params.set('q', query);
    fetch(`/api/assets?${params.toString()}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('图片素材暂时无法加载'); return response.json(); })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (payload.ok === false) throw new Error('图片素材暂时无法加载');
        setItems(payload.data ?? []);
        setTotal(payload.meta?.total ?? 0);
      })
      .catch(() => { if (!controller.signal.aborted) setError('图片素材暂时无法加载，请重试。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, retry]);

  return (
    <section className="library-panel w-[360px] shrink-0 bg-mist-50 text-ink-600 flex flex-col min-h-0">
      <div className="panel-heading"><h2>图片素材</h2><p>点选图片，插入当前文稿</p></div>
      <div className="px-3 py-2 border-b border-mist-200">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索图片素材"
          placeholder="按文件名搜索"
          className="w-full bg-white border border-mist-200 rounded px-2 py-1.5 text-[12px] placeholder:text-ink-600 focus:outline-none focus:border-accent-400"
        />
      </div>
      <div className="px-3 py-1.5 text-[11px] text-ink-600">
        {loading ? '加载中…' : `已镜像 ${total} 个`}
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4 grid grid-cols-3 gap-2 content-start">
        {!loading && !error && items.map((item) => (
          <button
            key={item.url}
            aria-label={`插入图片：${item.path}`}
            onClick={() => addImageBlock(item.url)}
            title={item.url}
            className="h-[100px] rounded border border-mist-200 bg-white/5 overflow-hidden hover:border-accent-400 cursor-pointer"
          >
            <img
              src={`/assets/${item.path}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </button>
        ))}
        {loading && <PanelState title="正在加载素材" loading />}
        {error && <PanelState title="素材加载失败" detail={error} action="重新加载" onAction={() => setRetry(v => v + 1)} />}
        {!loading && !error && items.length === 0 && <PanelState title={query ? '没有匹配的图片' : '素材库还没有图片'} detail={query ? '换一个关键词，或清空搜索看看。' : '可从顶栏上传图片，或在「我的图库」选择团队图片。'} action={query ? '清空搜索' : undefined} onAction={() => setQuery('')} />}

      </div>
    </section>
  );
}
