import { useEffect, useRef, useState } from 'react';
import { listSlots, plainText, toHtml, type SlotInfo } from '../lib/slots.ts';
import { blockKind, blockSummary } from '../lib/block-label.ts';
import { Icon } from './Icon.tsx';
import { PanelState } from './PanelState.tsx';
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
        <h2 className="text-[13px] font-medium text-ink-900">文稿结构</h2>
        <p className="text-[11px] text-ink-600/50 mt-0.5">
          {doc.blocks.length} 个内容块{errorCount > 0 ? ` · ${errorCount} 个错误` : ''}{warnCount > 0 ? ` · ${warnCount} 条提醒` : ''}
        </p>
      </div>

      {selectedIds.length>1&&<div className="flex gap-2 px-3 py-2 text-xs border-b border-mist-200"><span>{selectedIds.length} 块</span><button onClick={()=>batch('copy')}>复制</button><button onClick={()=>batch('duplicate')}>复制一份</button><button onClick={()=>batch('delete')}>删除</button></div>}
      <div className="structure-list" aria-label="文稿内容列表">
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
            className={`structure-row ${selected === index || selectedIds.includes(item.id) ? 'is-selected' : ''} ${dragOver === index ? 'is-drop-target' : ''}`}
          >
            <button
              className="structure-select"
              aria-pressed={selected === index || selectedIds.includes(item.id)}
              onClick={event => select(index, event.ctrlKey || event.metaKey || event.shiftKey)}
              title={blockSummary(item)}
            >
              <span className="structure-index">{index + 1}</span>
              <span className="structure-title">{blockSummary(item)}</span>
              <span className="structure-kind">{blockKind(item)}</span>
            </button>
          </div>
        ))}
        {doc.blocks.length === 0 && (
          <PanelState title="从第一段开始" detail="选择左侧模板，或用顶栏「正文」插入文字。" />
        )}
      </div>

      {block && selected !== null && <div className="selection-actions" aria-label="选中内容操作">
        <button className="structure-tool" title="上移" aria-label="上移" disabled={selected === 0} onClick={() => moveBlock(selected, selected - 1)}><Icon name="arrow" style={{ transform: 'rotate(90deg)' }} size={16} /></button>
        <button className="structure-tool" title="下移" aria-label="下移" disabled={selected === doc.blocks.length - 1} onClick={() => moveBlock(selected, selected + 1)}><Icon name="arrow" style={{ transform: 'rotate(-90deg)' }} size={16} /></button>
        <button className="structure-tool" title="复制到剪贴板" aria-label="复制到剪贴板" onClick={() => copyBlock(selected)}><Icon name="copy" size={16} /></button>
        <span className="selection-action-spacer" />
        <button className="structure-tool danger-action" title="删除" aria-label="删除" onClick={() => removeBlock(selected)}><Icon name="trash" size={16} /></button>
      </div>}
      <div className="inspector-fields flex-1 overflow-y-auto px-4 py-3">
        {block?.kind === 'library' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] font-medium text-ink-800">编辑内容</h3>
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
            <h3 className="text-[12px] font-medium text-ink-800 mb-2">{blockKind(block)}</h3>
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
          <PanelState title="选择要调整的内容" detail="点击画布或上方列表，即可编辑文字、图片与样式。" />
        )}
      </div>

      {issues.length > 0 && (
        <div className="border-t border-mist-200 max-h-[160px] overflow-y-auto px-3 py-2">
          <h3 className="text-[11px] font-medium text-ink-800 mb-1">发布前检查</h3>
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
