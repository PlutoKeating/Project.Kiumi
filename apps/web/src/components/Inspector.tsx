import { useEffect, useRef, useState } from 'react';
import { listSlots, plainText, toHtml, type SlotInfo } from '../lib/slots.ts';
import { MarkupEditor } from './MarkupEditor.tsx';
import { useStore } from '../store.ts';

export function Inspector() {
  const doc = useStore((state) => state.doc);
  const selectedIds = useStore(state=>state.selectedIds);
  const batch = useStore(state=>state.batch);
  const selected = useStore((state) => state.selected);
  const issues = useStore((state) => state.issues);
  const select = useStore((state) => state.select);
  const removeBlock = useStore((state) => state.removeBlock);
  const moveBlock = useStore((state) => state.moveBlock);
  const updateSlot = useStore((state) => state.updateSlot);
  const updateNative = useStore((state) => state.updateNative);
  const copyBlock = useStore((state) => state.copyBlock);
  const favorites = useStore((state) => state.favorites);
  const toggleFavorite = useStore((state) => state.toggleFavorite);

  const block = selected === null ? null : doc.blocks[selected];
  const slots = block?.kind === 'library' ? listSlots(block.matrix) : [];

  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const warnCount = issues.filter((issue) => issue.level === 'warn').length;

  return (
    <aside className="inspector w-[320px] shrink-0 bg-white border-l border-mist-200 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-mist-200">
        <h2 className="text-[13px] font-medium text-ink-900">结构</h2>
        <p className="text-[11px] text-ink-600/50 mt-0.5">
          {doc.blocks.length} 块 · {errorCount} 错误 · {warnCount} 警告
        </p>
      </div>

      {selectedIds.length>1&&<div className="flex gap-2 px-3 py-2 text-xs border-b border-mist-200"><span>{selectedIds.length} 块</span><button onClick={()=>batch('copy')}>复制</button><button onClick={()=>batch('duplicate')}>复制一份</button><button onClick={()=>batch('delete')}>删除</button></div>}
      <div className="max-h-[240px] overflow-y-auto border-b border-mist-200">
        {doc.blocks.map((item, index) => (
          <div
            key={item.id}
            draggable
            onDragStart={() => {
              dragFrom.current = index;
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(index);
            }}
            onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragFrom.current;
              dragFrom.current = null;
              setDragOver(null);
              if (from !== null && from !== index) moveBlock(from, index);
            }}
            onDragEnd={() => {
              dragFrom.current = null;
              setDragOver(null);
            }}
            className={`flex items-center gap-2 px-3 py-2 text-[12px] cursor-grab border-l-2 ${
              (selected === index || selectedIds.includes(item.id))
                ? 'bg-accent-500/10 border-accent-500'
                : 'border-transparent hover:bg-mist-50'
            } ${dragOver === index ? 'outline outline-1 outline-accent-400/60' : ''}`}
            onClick={event => select(index,event.ctrlKey||event.metaKey||event.shiftKey)}
          >
            <span className="text-ink-600/40 w-4 text-right">{index + 1}</span>
            <span className="flex-1 truncate text-ink-800">
              {item.kind === 'library' ? item.tplId : `原生 · ${item.node.kind}`}
            </span>
            <button
              className="structure-tool text-ink-600/60 hover:text-ink-800"
              onClick={(event) => {
                event.stopPropagation();
                moveBlock(index, index - 1);
              }}
              title="上移"
            >
              ↑
            </button>
            <button
              className="structure-tool text-ink-600/60 hover:text-ink-800"
              onClick={(event) => {
                event.stopPropagation();
                moveBlock(index, index + 1);
              }}
              title="下移"
            >
              ↓
            </button>
            <button
              className="structure-tool text-ink-600/60 hover:text-ink-800"
              onClick={(event) => {
                event.stopPropagation();
                copyBlock(index);
              }}
              title="复制到剪贴板"
            >
              ⧉
            </button>
            <button
              className="structure-tool block-tool-delete text-ink-600/60 hover:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                removeBlock(index);
              }}
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
        {doc.blocks.length === 0 && (
          <p className="px-4 py-4 text-[12px] text-ink-600/40">还没有内容</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {block?.kind === 'library' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] font-medium text-ink-800">槽位</h3>
              <button
                onClick={() => toggleFavorite(block.tplId)}
                className={`text-[11px] px-2 py-0.5 rounded border ${
                  favorites.includes(block.tplId)
                    ? 'border-accent-500 text-accent-500'
                    : 'border-mist-200 text-ink-600/60'
                }`}
              >
                {favorites.includes(block.tplId) ? '已收藏' : '收藏模板'}
              </button>
            </div>
            {block.html ? <MarkupEditor key={block.id} index={selected!} html={block.html} /> : <div className="space-y-3">
              {slots.map((slot, index) => (
                <SlotEditor
                  key={`${slot.path}-${index}`}
                  slot={slot}
                  onCommit={(value) => updateSlot(selected!, slot.path, value, slot.compIndex)}
                />
              ))}
              {slots.length === 0 && (
                <p className="text-[12px] text-ink-600/40">该模板没有可编辑的文字或图片槽位</p>
              )}
            </div>}
          </>
        )}

        {block?.kind === 'native' && (
          <>
            <h3 className="text-[12px] font-medium text-ink-800 mb-2">原生块</h3>
            {block.node.kind === 'heading' || block.node.kind === 'text' || block.node.kind === 'quote' ? (
              <label className="block">
                <span className="text-[11px] text-ink-600/60">文字</span>
                <textarea
                  key={`${block.id}-text`}
                  defaultValue={plainText(block.node.html ?? block.node.text ?? '')}
                  onBlur={(event) => updateNative(selected!, { html: toHtml(event.target.value) })}
                  rows={5}
                  className="mt-1 w-full text-[12px] border border-mist-200 rounded px-2 py-1.5 focus:outline-none focus:border-accent-400"
                />
              </label>
            ) : block.node.kind === 'image' ? (
              <label className="block">
                <span className="text-[11px] text-ink-600/60">图片地址</span>
                <input
                  key={`${block.id}-src`}
                  defaultValue={block.node.src ?? ''}
                  onBlur={(event) => updateNative(selected!, { src: event.target.value })}
                  className="mt-1 w-full text-[12px] border border-mist-200 rounded px-2 py-1.5 focus:outline-none focus:border-accent-400"
                />
              </label>
            ) : (
              <p className="text-[12px] text-ink-600/40">该块无需编辑</p>
            )}
          </>
        )}

        {!block && (
          <p className="text-[12px] text-ink-600/40">在画布或上方列表中选择一个块</p>
        )}
      </div>

      {issues.length > 0 && (
        <div className="border-t border-mist-200 max-h-[160px] overflow-y-auto px-3 py-2">
          <h3 className="text-[11px] font-medium text-ink-800 mb-1">校验</h3>
          {issues.slice(0, 12).map((issue, index) => (
            <p
              key={`${issue.rule}-${index}`}
              className={`text-[11px] leading-relaxed ${
                issue.level === 'error' ? 'text-red-600' : issue.level === 'warn' ? 'text-amber-600' : 'text-ink-600/50'
              }`}
            >
              {issue.rule}: {issue.message}
            </p>
          ))}
        </div>
      )}
    </aside>
  );
}

function SlotEditor({ slot, onCommit }: { slot: SlotInfo; onCommit: (value: string) => void }) {
  const [value, setValue] = useState(slot.prop === 'text' ? plainText(slot.value) : slot.value);

  useEffect(() => {
    setValue(slot.prop === 'text' ? plainText(slot.value) : slot.value);
  }, [slot.value, slot.prop]);

  return (
    <label className="block">
      <span className="text-[11px] text-ink-600/60 flex items-center gap-1">
        <span className="px-1 py-0.5 rounded bg-mist-100 text-[10px] text-ink-600">{slot.label}</span>
        {slot.prop === 'text' ? '文字' : '图片'}
      </span>
      {slot.prop === 'text' ? (
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => onCommit(toHtml(value))}
          rows={3}
          className="mt-1 w-full text-[12px] border border-mist-200 rounded px-2 py-1.5 focus:outline-none focus:border-accent-400"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => onCommit(value)}
          placeholder="https://..."
          className="mt-1 w-full text-[12px] border border-mist-200 rounded px-2 py-1.5 focus:outline-none focus:border-accent-400"
        />
      )}
    </label>
  );
}
