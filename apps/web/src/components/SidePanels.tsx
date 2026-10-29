import { renderDocument } from '@kiumi/core';
import { useEffect, useState } from 'react';
import { listUploads, previewUrl } from '../api.ts';
import { useStore } from '../store.ts';

function PanelShell({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="library-panel w-[360px] shrink-0 bg-mist-50 text-ink-600 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-mist-200 text-[13px] flex items-center justify-between">
        <span>{title}</span>
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
        <p className="text-[12px] text-ink-600">
          还没有收藏。选中内容后，点击浮动工具栏「收藏」，保存内容和样式。
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {favoriteBlocks.map(block => <div key={block.id} className="rounded-xl bg-white overflow-hidden border border-mist-200">
          <div className="h-[110px] overflow-hidden"><iframe title="收藏内容预览" className="preview-frame" sandbox="" tabIndex={-1} srcDoc={renderDocument({ ...doc, blocks: [block] }).html} /></div>
          <div className="flex justify-between p-2 text-xs"><button onClick={() => useStore.getState().insertFavorite(block.id)}>使用</button><button onClick={() => useStore.getState().toggleBlockFavorite(block)}>移除</button></div>
        </div>)}
        {favorites.map((id) => (
          <div key={id} className="rounded border border-mist-200 bg-white overflow-hidden">
            <div className="h-[110px] overflow-hidden">
              <iframe className="preview-frame" src={previewUrl(id)} loading="lazy" sandbox="" tabIndex={-1} />
            </div>
            <div className="flex items-center justify-between px-1.5 py-1 bg-white">
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
        <button className="text-[11px] text-ink-600 hover:text-ink-900" onClick={clearClipboard}>
          清空
        </button>
      </div>
      {clipboard.length === 0 && (
        <p className="text-[12px] text-ink-600">
          剪贴板为空。在结构列表里点「复制」把块放进来，可跨文档复用。
        </p>
      )}
      <div className="space-y-2">
        {clipboard.map((block, index) => (
          <div
            key={`${block.id}-${index}`}
            className="rounded border border-mist-200 bg-white px-2 py-1.5 flex items-center gap-2"
          >
            <span className="text-[11px] text-ink-600">
              {block.kind === 'library' ? '模板' : `原生·${block.node.kind}`}
            </span>
            <span className="flex-1 truncate text-[11px] text-ink-600">
              {block.kind === 'library' ? block.tplId : block.id}
            </span>
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

  useEffect(() => {
    let alive = true;
    listUploads()
      .then((items) => { if (alive) setItems(items); })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PanelShell title="我的图库" hint={loading ? '加载中…' : `${items.length} 张`}>
      {!loading && items.length === 0 && (
        <p className="text-[12px] text-ink-600">还没有上传过图片，用顶栏「上传图片」添加。</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <div
            key={item.name}
            role="button"
            tabIndex={0}
            title={item.name}
            onClick={() => addImageBlock(item.url)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') addImageBlock(item.url);
            }}
            className="h-[100px] rounded border border-mist-200 bg-white/5 overflow-hidden hover:border-accent-400 cursor-pointer"
          >
            <img src={item.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
