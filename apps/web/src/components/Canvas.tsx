import { useEffect, useRef, useState } from 'react';
import { primaryTextSlot } from '../lib/slots.ts';
import { useStore } from '../store.ts';

export function Canvas() {
  const doc = useStore((state) => state.doc);
  const previews = useStore((state) => state.previews);
  const selected = useStore((state) => state.selected);
  const select = useStore((state) => state.select);
  const zoom = useStore((state) => state.zoom);
  const setZoom = useStore((state) => state.setZoom);
  const setTitle = useStore((state) => state.setTitle);
  const setDigest = useStore((state) => state.setDigest);
  const updateSlot = useStore((state) => state.updateSlot);
  const [editing, setEditing] = useState<{ block: number; slot: string } | null>(null);
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const previewRef = useRef<HTMLDivElement>(null);

  // Upstream drops some template assets; show a neutral box instead of a
  // broken-image glyph. Export and copy keep the original markup.
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    for (const img of root.querySelectorAll('img')) {
      img.onerror = () => {
        img.removeAttribute('src');
        img.style.background = '#eef0f4';
        img.style.minWidth = '48px';
        img.style.minHeight = '32px';
      };
    }
  }, [previews]);

  // Double-click a block to edit its primary text slot in place, like the
  // official editor does. The inspector remains the full-fidelity surface.
  const startInlineEdit = (index: number) => {
    const block = doc.blocks[index];
    if (!block || block.kind !== 'library') return;
    const slot = primaryTextSlot(block.matrix);
    if (!slot) return;
    const root = blockRefs.current.get(index);
    const target = root?.querySelector<HTMLElement>(`[tn-bind-cell="${slot}"]`);
    if (!target) return;
    target.setAttribute('contenteditable', 'true');
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setEditing({ block: index, slot });
  };

  const finishInlineEdit = (index: number, slot: string) => {
    const root = blockRefs.current.get(index);
    const target = root?.querySelector<HTMLElement>(`[tn-bind-cell="${slot}"]`);
    if (!target) {
      setEditing(null);
      return;
    }
    const html = target.innerHTML.trim();
    target.removeAttribute('contenteditable');
    setEditing(null);
    if (html) updateSlot(index, slot, html);
  };

  return (
    <main className="flex-1 min-w-0 overflow-y-auto bg-mist-100">
      <div className="flex justify-center px-6 py-6">
        <div
          className="w-[430px] shrink-0 transition-transform"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          <div
            ref={previewRef}
            className="rounded-xl shadow-[0_8px_30px_rgba(18,21,28,0.10)] bg-white min-h-[720px] px-5 py-6"
          >
            <div className="mb-4 pb-3 border-b border-mist-200">
              <input
                value={doc.title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="请输入图文标题"
                className="w-full text-[18px] font-medium text-ink-900 placeholder:text-ink-600/30 focus:outline-none"
              />
              <textarea
                value={doc.meta.digest ?? ''}
                onChange={(event) => setDigest(event.target.value)}
                placeholder="微信分享时的摘要，点击左侧图片可改封面"
                rows={2}
                className="mt-1 w-full text-[12px] text-ink-600 placeholder:text-ink-600/30 resize-none focus:outline-none"
              />
            </div>

            {doc.blocks.length === 0 && (
              <div className="h-[600px] flex flex-col items-center justify-center text-center gap-2 text-ink-600/40">
                <span className="text-4xl">▤</span>
                <p className="text-[13px]">从左侧点击模板，或使用顶部工具插入基础块</p>
              </div>
            )}

            {doc.blocks.map((block, index) => (
              <div
                key={block.id}
                ref={(element) => {
                  if (element) blockRefs.current.set(index, element);
                  else blockRefs.current.delete(index);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (editing && editing.block !== index) setEditing(null);
                  select(index);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  startInlineEdit(index);
                }}
                onBlur={(event) => {
                  if (editing?.block === index) {
                    const next = event.relatedTarget as HTMLElement | null;
                    if (next && event.currentTarget.contains(next)) return;
                    finishInlineEdit(index, editing.slot);
                  }
                }}
                className={`relative cursor-pointer transition rounded ${
                  selected === index ? 'block-selected' : 'hover:outline hover:outline-1 hover:outline-accent-400/40'
                }`}
              >
                <div
                  className={editing?.block === index ? '' : 'pointer-events-none'}
                  dangerouslySetInnerHTML={{ __html: previews[block.id] ?? '' }}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 mt-3 text-[11px] text-ink-600/50">
            <span>{doc.blocks.length} 个块</span>
            <span className="text-ink-600/20">|</span>
            <button onClick={() => setZoom(zoom - 10)} className="px-1 hover:text-ink-900">
              −
            </button>
            <span className="w-10 text-center">{zoom}%</span>
            <button onClick={() => setZoom(zoom + 10)} className="px-1 hover:text-ink-900">
              +
            </button>
            <button onClick={() => setZoom(100)} className="px-1 hover:text-ink-900" title="复位">
              复位
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
