import { blockKind, blockSummary } from '../lib/block-label.ts';
import { PanelState } from './PanelState.tsx';
import { renderDocument } from '@kiumi/core';
import { useEffect, useState } from 'react';
import { listUploads, previewUrl } from '../api.ts';
import { useStore } from '../store.ts';

function PanelShell({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="library-panel w-[360px] shrink-0 bg-mist-50 text-ink-600 flex flex-col min-h-0">
      <div className="panel-heading flex items-center justify-between">
        <h2>{title}</h2>
        {hint && <span className="text-[11px] text-ink-600">{hint}</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

export function FavoritesPanel() {
  const favorites = useStore((state) => state.favorites);
  const favoriteBlocks = useStore(state => state.favoriteBlocks);
  const doc = useStore(state => state.doc);
  const insertTemplate = useStore((state) => state.insertTemplate);
  const toggleFavorite = useStore((state) => state.toggleFavorite);

  return (
    <PanelShell title="图文收藏" hint={`${favorites.length + favoriteBlocks.length} 个`}>
      {favorites.length + favoriteBlocks.length === 0 && (
        <PanelState title="留住喜欢的排版" detail="选中内容，点击工具栏「收藏」，下次可连同文字和样式一起使用。" />
      )}
      <div className="grid grid-cols-2 gap-2">
        {favoriteBlocks.map(block => <div key={block.id} className="saved-card">
          <div className="h-[110px] overflow-hidden"><iframe title="收藏内容预览" className="preview-frame" sandbox="" tabIndex={-1} srcDoc={renderDocument({ ...doc, blocks: [block] }).html} /></div>
          <p className="saved-card-title" title={blockSummary(block)}>{blockSummary(block)}</p><div className="saved-card-actions"><button onClick={() => useStore.getState().insertFavorite(block.id)}>使用</button><button onClick={() => useStore.getState().toggleBlockFavorite(block)}>移除</button></div>
        </div>)}
        {favorites.map((id) => (
          <div key={id} className="saved-card">
            <div className="h-[110px] overflow-hidden">
              <iframe title="收藏模板预览" className="preview-frame" src={previewUrl(id)} loading="lazy" sandbox="" tabIndex={-1} />
            </div>
            <p className="saved-card-title">图文模板</p><div className="saved-card-actions">
              <button
                className="text-[11px] text-ink-800 truncate"
                onClick={() => void insertTemplate(id)}
                title={id}
              >
                使用
              </button>
              <button className="text-[11px] text-ink-600/50" onClick={() => toggleFavorite(id)}>
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

export function ClipboardPanel() {
  const clipboard = useStore((state) => state.clipboard);
  const insertClipboard = useStore((state) => state.insertClipboard);
  const clearClipboard = useStore((state) => state.clearClipboard);

  return (
    <PanelShell title="剪贴板" hint={`${clipboard.length} 项`}>
      <div className="flex justify-end mb-2">
        <button className="text-[11px] text-ink-600 hover:text-ink-900" disabled={clipboard.length === 0} onClick={clearClipboard}>
          清空
        </button>
      </div>
      {clipboard.length === 0 && (
        <PanelState title="随手收集，跨稿复用" detail="选中内容，点击「复制到剪贴板」，再到这里粘贴到当前文稿。" />
      )}
      <div className="space-y-2">
        {clipboard.map((block, index) => (
          <div
            key={`${block.id}-${index}`}
            className="clipboard-item"
          >
            <div className="clipboard-content"><span>{blockKind(block)}</span><p title={blockSummary(block)}>{blockSummary(block)}</p></div>
            <button
              className="text-[11px] text-accent-400"
              onClick={() => insertClipboard(index)}
            >
              粘贴
            </button>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

interface UploadItem {
  name: string;
  bytes: number;
  mtime: number;
  url: string;
}

export function GalleryPanel() {
  const addImageBlock = useStore((state) => state.addImageBlock);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    listUploads()
      .then((items) => { if (alive) setItems(items); })
      .catch(() => { if (alive) setError('请先在「团队与文稿」登录并选择团队；已选择团队时可重试。'); })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [retry]);

  return (
    <PanelShell title="我的图库" hint={loading ? '加载中…' : `${items.length} 张`}>
      {loading && <PanelState title="正在加载团队图库" loading />}
      {error && <PanelState title="图库暂时无法读取" detail={error} action="重试" onAction={() => setRetry(v => v + 1)} />}
      {!loading && !error && items.length === 0 && (
        <PanelState title="建立团队的图片库" detail="使用顶栏「上传图片」添加，团队成员可在这里一起选用。" />
      )}
      <div className="grid grid-cols-3 gap-2">
        {!loading && !error && items.map((item) => (
          <button
            key={item.url}
            aria-label={`插入图片：${item.name}`}
            title={item.name}
            onClick={() => addImageBlock(item.url)}
            className="h-[100px] rounded border border-mist-200 bg-white/5 overflow-hidden hover:border-accent-400 cursor-pointer"
          >
            <img src={item.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}
