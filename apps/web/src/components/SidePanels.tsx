import { blockKind, blockSummary } from '../lib/block-label.ts';
import { PanelState } from './PanelState.tsx';
import { renderDocument } from '@kiumi/core';
import { useEffect, useState } from 'react';
import { listUploads, previewUrl, teamId } from '../api.ts';
import { ARTICLE_CSS } from '../lib/article-context.ts';
import { useStore } from '../store.ts';

function PanelShell({ title, hint, label, children, action }: { title: string; hint?: string; label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="library-panel" aria-label={label}>
      <div className="panel-top"><header className="panel-heading"><h2>{title}</h2><span>{hint}</span>{action}</header></div>
      <div className="panel-scroll">{children}</div>
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
    <PanelShell label="图文收藏" title="图文收藏" hint={`${favorites.length + favoriteBlocks.length} 个`}>
      {favorites.length + favoriteBlocks.length === 0 && (
        <PanelState icon="star" title="留住喜欢的排版" detail="选中内容，点工具条上的星标；模板卡片右上角也能收藏。" />
      )}
      <div className="saved-grid">
        {favoriteBlocks.map(block => <article key={block.id} className="saved-card">
          <div className="saved-preview"><iframe title="收藏内容预览" className="preview-frame" sandbox="" tabIndex={-1} srcDoc={`<!doctype html><style>${ARTICLE_CSS}</style><body>${renderDocument({ ...doc, blocks: [block] }).html}</body>`} /></div>
          <p title={blockSummary(block)}>{blockSummary(block)}</p>
          <div className="saved-actions"><button type="button" onClick={() => useStore.getState().insertFavorite(block.id)}>使用</button><button type="button" onClick={() => useStore.getState().toggleBlockFavorite(block)}>移除</button></div>
        </article>)}
        {favorites.map((id) => (
          <article key={id} className="saved-card">
            <div className="saved-preview"><iframe title="收藏模板预览" className="preview-frame" src={previewUrl(id)} loading="lazy" sandbox="" tabIndex={-1} /></div>
            <p>图文模板</p>
            <div className="saved-actions"><button type="button" onClick={() => void insertTemplate(id)} title={id}>使用</button><button type="button" onClick={() => toggleFavorite(id)}>移除</button></div>
          </article>
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
    <PanelShell label="剪贴板" title="剪贴板" hint={`${clipboard.length} 项`} action={clipboard.length > 0 ? <button type="button" className="text-action" onClick={clearClipboard}>清空</button> : undefined}>
      {clipboard.length === 0 && (
        <PanelState icon="clipboard" title="随手收集，跨稿复用" detail="选中内容后按 Ctrl/⌘ C，或在工具条选「复制到块剪贴板」。" />
      )}
      <div className="clipboard-list">
        {clipboard.map((block, index) => (
          <div key={`${block.id}-${index}`} className="clipboard-item">
            <div><span>{blockKind(block)}</span><p title={blockSummary(block)}>{blockSummary(block)}</p></div>
            <button type="button" className="btn btn-tint" onClick={() => insertClipboard(index)}>粘贴</button>
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
    if (!teamId()) { setLoading(false); return; } // No team is a next step, not a failure.
    let alive = true;
    setLoading(true); setError('');
    listUploads()
      .then((items) => { if (alive) setItems(items); })
      .catch(() => { if (alive) setError('团队图库暂时无法读取，请重试。'); })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [retry]);

  return (
    <PanelShell label="我的图库" title="我的图库" hint={!teamId() ? undefined : loading ? '加载中' : `${items.length} 张`}>
      {!teamId() && <PanelState icon="user" title="登录后查看团队图库" detail="图库在团队内共享。登录并加入团队后，就能在这里选用图片。" action="登录 / 注册" onAction={() => window.location.assign(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`)} />}
      {loading && <PanelState title="正在加载团队图库" loading />}
      {error && <PanelState tone="error" icon="alert" title="图库暂时无法读取" detail={error} action="重试" onAction={() => setRetry(v => v + 1)} />}
      {teamId() && !loading && !error && items.length === 0 && (
        <PanelState icon="gallery" title="建立团队的图片库" detail="用底部「上传」添加图片，团队成员可在这里一起选用。" />
      )}
      <div className="image-grid is-flush">
        {!loading && !error && items.map((item) => (
          <button type="button" key={item.url} className="image-tile" aria-label={`插入图片：${item.name}`} title={item.name} onClick={() => addImageBlock(item.url)}>
            <img src={item.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}
