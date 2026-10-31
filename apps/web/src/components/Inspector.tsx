import { useEffect, useRef, useState } from 'react';
import { listSlots, plainText, toHtml, type SlotInfo } from '../lib/slots.ts';
import { blockKind, blockSummary } from '../lib/block-label.ts';
import { ArticleSettings } from './ArticleSettings.tsx';
import { Icon } from './Icon.tsx';
import { PanelState } from './PanelState.tsx';
import { MarkupEditor } from './MarkupEditor.tsx';
import { IconButton, Segmented } from './ui.tsx';
import { useStore } from '../store.ts';

type Tab = 'content' | 'outline' | 'article';
const TABS = [{ value: 'content', label: '内容' }, { value: 'outline', label: '大纲' }, { value: 'article', label: '图文' }] as const;

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

  const [tab, setTab] = useState<Tab>('article');
  const block = selected === null ? null : doc.blocks[selected];
  const slots = block?.kind === 'library' ? listSlots(block.matrix) : [];

  // Selecting a block means "work on this": leave article settings. The outline stays put, it is the selection tool.
  useEffect(() => { if (selected !== null) setTab(current => current === 'article' ? 'content' : current); }, [selected]);

  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const problems = issues.filter((issue) => issue.level === 'error' || issue.level === 'warn').length;

  return (
    <aside className="island inspector" aria-label="检查器">
      <div className="inspector-tabs">
        <Segmented label="检查器视图" value={tab} onChange={setTab} options={TABS} />
        {problems > 0 && tab !== 'article' && <button type="button" className="issue-dot" aria-label={`发布前有 ${problems} 项要看`} data-tip={`发布前有 ${problems} 项要看`} onClick={() => setTab('article')}>{problems}</button>}
      </div>

      <div className="inspector-body" key={tab}>
        {tab === 'article' && <ArticleSettings />}

        {tab === 'outline' && <div className="structure-list" aria-label="文稿内容列表">
          {doc.blocks.map((item, index) => {
            const active = selected === index || selectedIds.includes(item.id);
            return <div
              key={item.id}
              draggable
              onDragStart={() => { dragFrom.current = index; }}
              onDragOver={(event) => { event.preventDefault(); setDragOver(index); }}
              onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                setDragOver(null);
                if (from !== null && from !== index) moveBlock(from, index);
              }}
              onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
              className="structure-row"
              data-selected={active}
              data-drop={dragOver === index}
            >
              <button type="button" className="structure-select" aria-pressed={active} onClick={event => select(index, event.ctrlKey || event.metaKey || event.shiftKey)} title={blockSummary(item)}>
                <span className="structure-index">{index + 1}</span>
                <span className="structure-title">{blockSummary(item)}</span>
                <span className="structure-kind">{blockKind(item)}</span>
              </button>
            </div>;
          })}
          {doc.blocks.length === 0 && <PanelState icon="text" title="大纲还是空的" detail="插入内容后，这里会列出每一块，可拖动排序。" />}
        </div>}

        {tab === 'content' && <div className="inspector-fields">
          {block?.kind === 'library' && (
            <>
              <header className="fields-head">
                <h3>编辑内容</h3>
                <button type="button" className="text-action" data-on={favorites.includes(block.tplId)} aria-pressed={favorites.includes(block.tplId)} onClick={() => toggleFavorite(block.tplId)}>
                  <Icon name="star" size={14} />{favorites.includes(block.tplId) ? '已收藏' : '收藏模板'}
                </button>
              </header>
              {block.html ? <MarkupEditor key={block.id} index={selected!} html={block.html} /> : <div className="field-stack">
                {slots.map((slot, index) => (
                  <SlotEditor key={`${slot.path}-${index}`} slot={slot} onCommit={(value) => updateSlot(selected!, slot.path, value, slot.compIndex)} />
                ))}
                {slots.length === 0 && <p className="quiet-note">这个模板没有可编辑的文字或图片。</p>}
              </div>}
            </>
          )}

          {block?.kind === 'native' && (
            <>
              <header className="fields-head"><h3>{blockKind(block)}</h3></header>
              {block.node.kind === 'heading' || block.node.kind === 'text' || block.node.kind === 'quote' ? (
                <label className="field-label">文字
                  <textarea className="field" key={`${block.id}-text`} defaultValue={plainText(block.node.html ?? block.node.text ?? '')} onBlur={(event) => updateNative(selected!, { html: toHtml(event.target.value) })} rows={5} />
                </label>
              ) : block.node.kind === 'image' ? (
                <label className="field-label">图片地址
                  <input className="field" key={`${block.id}-src`} defaultValue={block.node.src ?? ''} onBlur={(event) => updateNative(selected!, { src: event.target.value })} placeholder="https://…" />
                </label>
              ) : (
                <p className="quiet-note">这一块没有需要填写的内容。</p>
              )}
            </>
          )}

          {!block && <PanelState icon="locate" title="选择要调整的内容" detail="在画布上点一块，这里就能改文字、图片和颜色。" />}
        </div>}
      </div>

      {tab !== 'article' && selectedIds.length > 1 && <div className="selection-actions" aria-label="批量操作">
        <span>已选 {selectedIds.length} 块</span>
        <span className="selection-action-spacer" />
        <IconButton icon="clipboard" label="批量复制到剪贴板" onClick={() => batch('copy')} />
        <IconButton icon="copy" label="批量复制一份" onClick={() => batch('duplicate')} />
        <IconButton icon="trash" label="批量删除" className="is-danger" onClick={() => batch('delete')} />
      </div>}
      {tab !== 'article' && selectedIds.length <= 1 && block && selected !== null && <div className="selection-actions" aria-label="选中内容操作">
        <IconButton className="structure-tool" icon="up" label="上移" disabled={selected === 0} onClick={() => moveBlock(selected, selected - 1)} />
        <IconButton className="structure-tool" icon="down" label="下移" disabled={selected === doc.blocks.length - 1} onClick={() => moveBlock(selected, selected + 1)} />
        <IconButton className="structure-tool" icon="clipboard" label="复制到剪贴板" onClick={() => copyBlock(selected)} />
        <span className="selection-action-spacer" />
        <IconButton className="structure-tool is-danger" icon="trash" label="删除" onClick={() => removeBlock(selected)} />
      </div>}
    </aside>
  );
}

function SlotEditor({ slot, onCommit }: { slot: SlotInfo; onCommit: (value: string) => void }) {
  const [value, setValue] = useState(slot.prop === 'text' ? plainText(slot.value) : slot.value);

  useEffect(() => {
    setValue(slot.prop === 'text' ? plainText(slot.value) : slot.value);
  }, [slot.value, slot.prop]);

  return (
    <label className="field-label">
      <span>{slot.label} · {slot.prop === 'text' ? '文字' : '图片'}</span>
      {slot.prop === 'text' ? (
        <textarea className="field" value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => onCommit(toHtml(value))} rows={3} />
      ) : (
        <input className="field" value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => onCommit(value)} placeholder="https://…" />
      )}
    </label>
  );
}
