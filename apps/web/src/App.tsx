import { renderDocument as renderLocal } from '@kiumi/core';
import { useEffect, useState } from 'react';
import { copyRichHtml, fetchSession, renderDocument, type SessionState } from './api.ts';
import { AssetsPanel } from './components/AssetsPanel.tsx';
import { Canvas } from './components/Canvas.tsx';
import { Inspector } from './components/Inspector.tsx';
import { ResourceIsland } from './components/ResourceIsland.tsx';
import { Modal } from './components/Modal.tsx';
import { ClipboardPanel, FavoritesPanel, GalleryPanel } from './components/SidePanels.tsx';
import { TemplateBrowser } from './components/TemplateBrowser.tsx';
import { Toast } from './components/Toast.tsx';
import { Topbar } from './components/Topbar.tsx';
import { SheetHeader } from './components/ui.tsx';
import { useStore } from './store.ts';

export function App() {
  const ready = useStore((state) => state.ready);
  const [session, setSession] = useState<SessionState | null>(null);
  useEffect(() => {
    void fetchSession().then(setSession);
  }, []);
  const doc = useStore((state) => state.doc);
  const boot = useStore((state) => state.boot);
  const save = useStore((state) => state.save);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const selected = useStore((state) => state.selected);
  const removeBlock = useStore((state) => state.removeBlock);
  const duplicateBlock = useStore((state) => state.duplicateBlock);
  const select = useStore((state) => state.select);
  const takeFormat = useStore((state) => state.takeFormat);
  const brushFormat = useStore((state) => state.brushFormat);
  const clearFormat = useStore((state) => state.clearFormat);

  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [rail, setRail] = useState('templates');
  const [collapsed, setCollapsed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const show = () => { setRail('templates'); setCollapsed(false); };
    window.addEventListener('kiumi:templates', show);
    return () => window.removeEventListener('kiumi:templates', show);
  }, []);

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
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const meta = event.metaKey || event.ctrlKey;

      // Save works even while typing.
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }

      if (editable(event.target)) return;
      if(meta && event.key.toLowerCase()==='a'){event.preventDefault();useStore.getState().selectAll();return;}
      if(meta && ['0','=','+','-'].includes(event.key)){event.preventDefault();const state=useStore.getState();state.setZoom(event.key==='0'?100:state.zoom+(event.key==='-'?-10:10));return;}
      if(meta && !event.altKey && event.key.toLowerCase()==='c' && useStore.getState().selectedIds.length){event.preventDefault();useStore.getState().batch('copy');return;}
      if(meta && !event.altKey && event.key.toLowerCase()==='v' && useStore.getState().clipboard.length){event.preventDefault();const state=useStore.getState();for(let i=0;i<state.clipboard.length;i++)useStore.getState().insertClipboard(i);return;}

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
      if (meta && event.altKey && event.key.toLowerCase() === 'c' && selected !== null) {
        event.preventDefault();
        takeFormat(selected);
        return;
      }
      if (meta && event.altKey && event.key.toLowerCase() === 'v' && selected !== null) {
        event.preventDefault();
        brushFormat(selected);
        return;
      }
      if (meta && event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        clearFormat();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd' && selected !== null) {
        event.preventDefault();
        useStore.getState().batch('duplicate');
        return;
      }
      if (meta && event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void onPreview();
        return;
      }
      if (!meta && (event.key === 'Delete' || event.key === 'Backspace') && selected !== null) {
        event.preventDefault();
        useStore.getState().batch('delete');
        return;
      }
      if (event.key === 'Escape') {
        select(null);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, selected, removeBlock, duplicateBlock, select, takeFormat, brushFormat, clearFormat]);

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
    useStore.setState({ message: '已复制富文本，可直接粘贴到公众号后台' });
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

  const onPreview = async () => setPreview(renderLocal(useStore.getState().doc).html);

  return (
    <div className="workbench" data-section={rail} data-collapsed={collapsed}>
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>

      <Topbar
        session={session}
        workspaceVersion={workspaceVersion}
        onWorkspaceChange={() => setWorkspaceVersion((value) => value + 1)}
        onPreview={() => void onPreview()}
        onCopy={onCopy}
        onExport={onExport}
      />

      <div className="stage">
        <ResourceIsland
          active={rail}
          onSelect={(key) => {
            setRail(key);
            setCollapsed(false);
          }}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        >
          {rail === 'templates' ? (
            <TemplateBrowser />
          ) : rail === 'assets' ? (
            <AssetsPanel />
          ) : rail === 'favorites' ? (
            <FavoritesPanel />
          ) : rail === 'clipboard' ? (
            <ClipboardPanel />
          ) : (
            <GalleryPanel key={workspaceVersion} />
          )}
        </ResourceIsland>
        <Canvas />
        <Inspector />
      </div>

      <Toast />

      {preview !== null && (
        <Modal onClose={() => setPreview(null)}>
          <section
            role="dialog" aria-modal="true" aria-label="文章预览" className="sheet sheet-preview"
            onClick={(event) => event.stopPropagation()}
          >
            <SheetHeader title="预览" detail={doc.title} onClose={() => setPreview(null)} />
            <iframe
              className="article-preview-frame"
              referrerPolicy="no-referrer"
              title="preview"
              sandbox=""
              srcDoc={`<body style="background:#fff;margin:0;padding:16px;max-width:677px;font-family:-apple-system,'PingFang SC',sans-serif">${preview}</body>`}
            />
          </section>
        </Modal>
      )}

      {!ready && <div className="boot-pill" role="status">正在加载…</div>}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
