import { useEffect, useRef } from 'react';
import { useStore } from '../store.ts';

export function Canvas() {
  const doc = useStore((state) => state.doc);
  const previews = useStore((state) => state.previews);
  const selected = useStore((state) => state.selected);
  const select = useStore((state) => state.select);
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

  return (
    <main className="flex-1 min-w-0 overflow-y-auto bg-mist-100">
      <div className="flex justify-center px-6 py-6">
        <div className="w-[430px] shrink-0">
          <div
            ref={previewRef}
            className="rounded-xl shadow-[0_8px_30px_rgba(18,21,28,0.10)] bg-white min-h-[720px] px-5 py-6"
          >
            {doc.blocks.length === 0 && (
              <div className="h-[600px] flex flex-col items-center justify-center text-center gap-2 text-ink-600/40">
                <span className="text-4xl">▤</span>
                <p className="text-[13px]">从左侧点击模板，或使用顶部工具插入基础块</p>
              </div>
            )}

            {doc.blocks.map((block, index) => (
              <div
                key={block.id}
                onClick={(event) => {
                  event.stopPropagation();
                  select(index);
                }}
                className={`relative cursor-pointer transition rounded ${
                  selected === index ? 'block-selected' : 'hover:outline hover:outline-1 hover:outline-accent-400/40'
                }`}
              >
                <div
                  className="pointer-events-none"
                  dangerouslySetInnerHTML={{ __html: previews[block.id] ?? '' }}
                />
              </div>
            ))}
          </div>

          <p className="text-center text-[11px] text-ink-600/40 mt-3">
            {doc.blocks.length} 个块 · 预览宽度 430px
          </p>
        </div>
      </div>
    </main>
  );
}
