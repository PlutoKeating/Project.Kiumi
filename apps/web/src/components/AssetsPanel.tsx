import { useEffect, useState } from 'react';
import { Icon } from './Icon.tsx';
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
    <section className="library-panel" aria-label="图片素材">
      <div className="panel-top">
        <header className="panel-heading"><h2>图片素材</h2><span>{loading ? '加载中' : `已镜像 ${total} 个`}</span></header>
        <label className="search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索图片素材" placeholder="按文件名搜索" />
          {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><Icon name="close" size={14} /></button>}
        </label>
      </div>
      <div className="image-grid">
        {!loading && !error && items.map((item) => (
          <button type="button" key={item.url} className="image-tile" aria-label={`插入图片：${item.path}`} onClick={() => addImageBlock(item.url)} title={item.path}>
            <img src={`/assets/${item.path}`} alt="" loading="lazy" />
          </button>
        ))}
        {loading && <PanelState title="正在加载素材" loading />}
        {error && <PanelState tone="error" icon="alert" title="素材加载失败" detail={error} action="重新加载" onAction={() => setRetry(v => v + 1)} />}
        {!loading && !error && items.length === 0 && <PanelState icon="image" title={query ? '没有匹配的图片' : '素材库还没有图片'} detail={query ? '换一个关键词，或清空搜索看看。' : '可用底部「上传」添加图片，或在「图库」选择团队图片。'} action={query ? '清空搜索' : undefined} onAction={() => setQuery('')} />}
      </div>
    </section>
  );
}
