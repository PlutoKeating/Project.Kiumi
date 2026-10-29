import { useEffect, useRef, useState } from 'react';
import { copyRichHtml, renderDocument, uploadImage } from './api.ts';
import { AssetsPanel } from './components/AssetsPanel.tsx';
import { ClipboardPanel, FavoritesPanel, GalleryPanel } from './components/SidePanels.tsx';
import { Canvas } from './components/Canvas.tsx';
import { Inspector } from './components/Inspector.tsx';
import { LeftRail } from './components/LeftRail.tsx';
import { TemplateBrowser } from './components/TemplateBrowser.tsx';
import { useStore } from './store.ts';

const NATIVE_TOOLS = [
  { kind: 'heading', label: '标题' },
  { kind: 'text', label: '正文' },
  { kind: 'image', label: '图片' },
  { kind: 'divider', label: '分割线' },
  { kind: 'spacer', label: '间距' },
] as const;

export function App() {
  const ready = useStore((state) => state.ready);
  const message = useStore((state) => state.message);
  const doc = useStore((state) => state.doc);
  const boot = useStore((state) => state.boot);
  const save = useStore((state) => state.save);
  const newDoc = useStore((state) => state.newDoc);
  const setTitle = useStore((state) => state.setTitle);
  const addNative = useStore((state) => state.addNative);
  const addImageBlock = useStore((state) => state.addImageBlock);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const canUndo = useStore((state) => state.past.length > 0);
  const canRedo = useStore((state) => state.future.length > 0);
  const selected = useStore((state) => state.selected);
  const removeBlock = useStore((state) => state.removeBlock);
  const duplicateBlock = useStore((state) => state.duplicateBlock);
  const select = useStore((state) => state.select);

  const [rail, setRail] = useState('templates');
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const editable = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    };

    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;

      // Save works even while typing.
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }

      if (editable(event.target)) return;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      // Redo on Windows/Linux, as xiumi does.
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd' && selected !== null) {
        event.preventDefault();
        duplicateBlock(selected);
        return;
      }
      if (meta && event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void onPreview();
        return;
      }
      if (!meta && (event.key === 'Delete' || event.key === 'Backspace') && selected !== null) {
        event.preventDefault();
        removeBlock(selected);
        return;
      }
      if (event.key === 'Escape') {
        select(null);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, selected, removeBlock, duplicateBlock, select]);

  // Read the document from the store so keyboard handlers never act on a stale
  // render closure.
  const renderFull = async (): Promise<string> => {
    const current = useStore.getState().doc;
    const result = await renderDocument(current);
    return result.html;
  };

  const onCopy = async () => {
    const html = await renderFull();
    await copyRichHtml(html);
    setPreview(null);
    alert('已复制富文本，可直接粘贴到公众号后台');
  };

  const onExport = async () => {
    const html = await renderFull();
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      doc.title,
    )}</title></head><body style="margin:0;padding:24px 16px;max-width:677px;">${html}</body></html>`;
    const blob = new Blob([body], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.title || 'article'}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const onPreview = async () => setPreview(await renderFull());

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 shrink-0 bg-white border-b border-mist-200 flex items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-md bg-accent-500 text-white grid place-items-center text-[13px] font-semibold">
            K
          </span>
          <span className="text-[13px] font-medium text-ink-900">Kiumi</span>
        </div>

        <input
          value={doc.title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-[240px] text-[13px] px-2 py-1.5 rounded border border-transparent hover:border-mist-200 focus:border-accent-400 focus:outline-none"
        />

        <div className="hidden md:flex items-center gap-1 pl-2 border-l border-mist-200">
          {NATIVE_TOOLS.map((tool) => (
            <button
              key={tool.kind}
              onClick={() => addNative(tool.kind)}
              className="text-[12px] px-2.5 py-1.5 rounded text-ink-600 hover:bg-mist-100"
            >
              {tool.label}
            </button>
          ))}
          <button
            onClick={() => fileRef.current?.click()}
            className="text-[12px] px-2.5 py-1.5 rounded text-ink-600 hover:bg-mist-100"
          >
            上传图片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              try {
                const uploaded = await uploadImage(file);
                addImageBlock(uploaded.url);
              } catch (error) {
                alert(`上传失败：${(error as Error).message}`);
              }
            }}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-ink-600/50 max-w-[220px] truncate">{message}</span>
          <button
            onClick={undo}
            disabled={!canUndo}
            title="撤销 (Cmd/Ctrl+Z)"
            className="text-[12px] px-2.5 py-1.5 rounded border border-mist-200 text-ink-600 hover:bg-mist-50 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            撤销
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="重做 (Cmd/Ctrl+Shift+Z)"
            className="text-[12px] px-2.5 py-1.5 rounded border border-mist-200 text-ink-600 hover:bg-mist-50 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            重做
          </button>
          <button onClick={newDoc} className="text-[12px] px-3 py-1.5 rounded border border-mist-200 text-ink-600 hover:bg-mist-50">
            新建
          </button>
          <button onClick={() => void save()} className="text-[12px] px-3 py-1.5 rounded border border-mist-200 text-ink-600 hover:bg-mist-50">
            保存
          </button>
          <button
            onClick={() => void onPreview()}
            className="text-[12px] px-3 py-1.5 rounded border border-mist-200 text-ink-600 hover:bg-mist-50"
          >
            预览
          </button>
          <button
            onClick={() => void onCopy()}
            className="text-[12px] px-3 py-1.5 rounded bg-accent-500 text-white hover:bg-accent-400"
          >
            复制到公众号
          </button>
          <button
            onClick={() => void onExport()}
            className="text-[12px] px-3 py-1.5 rounded border border-mist-200 text-ink-600 hover:bg-mist-50"
          >
            导出 HTML
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <LeftRail active={rail} onSelect={setRail} />
        {rail === 'templates' ? (
          <TemplateBrowser />
        ) : rail === 'assets' ? (
          <AssetsPanel />
        ) : rail === 'favorites' ? (
          <FavoritesPanel />
        ) : rail === 'clipboard' ? (
          <ClipboardPanel />
        ) : (
          <GalleryPanel />
        )}
        <Canvas />
        <Inspector />
      </div>

      {preview !== null && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/60 flex items-center justify-center p-8"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white rounded-xl overflow-hidden w-[420px] max-h-full flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-mist-200">
              <span className="text-[12px] text-ink-600">预览</span>
              <button className="text-[12px] text-ink-600/60" onClick={() => setPreview(null)}>
                关闭
              </button>
            </div>
            <iframe
              className="w-full flex-1 min-h-[600px]"
              referrerPolicy="no-referrer"
              title="preview"
              srcDoc={`<body style="margin:0;padding:16px;max-width:677px;font-family:-apple-system,'PingFang SC',sans-serif">${preview}</body>`}
            />
          </div>
        </div>
      )}

      {!ready && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-[12px] bg-ink-900 text-white px-3 py-1.5 rounded">
          正在连接本地服务…
        </div>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
