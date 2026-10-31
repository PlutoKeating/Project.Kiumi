import { Icon } from './Icon.tsx';
import { ArticleSettings } from './ArticleSettings.tsx';
import { BlockToolbar } from './BlockToolbar.tsx';
import { isPlaceholder } from '../lib/template-style.ts';
import { useEffect, useRef, useState } from 'react';
import { uploadImage } from '../api.ts';
import { cleanHtml } from '../lib/import.ts';
import { primaryTextSlot } from '../lib/slots.ts';
import { useStore } from '../store.ts';

export function Canvas() {
  const doc = useStore((state) => state.doc);
  const previews = useStore((state) => state.previews);
  const selectedIds = useStore(state=>state.selectedIds);
  const moveInto = useStore(state=>state.moveInto);
  const selected = useStore((state) => state.selected);
  const select = useStore((state) => state.select);
  const zoom = useStore((state) => state.zoom);
  const setZoom = useStore((state) => state.setZoom);
  const setTitle = useStore((state) => state.setTitle);
  const setDigest = useStore((state) => state.setDigest);
  const updateSlot = useStore((state) => state.updateSlot);
  const updateHtml = useStore((state) => state.updateHtml);
  const updateNative = useStore((state) => state.updateNative);
  const inlineTarget = useRef<{element:HTMLElement;path:number[]}|null>(null);
  const [editing, setEditing] = useState<{ block: number; slot: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; block: number } | null>(null);
  const addNative = useStore((state) => state.addNative);
  const removeBlock = useStore((state) => state.removeBlock);
  const moveBlock = useStore((state) => state.moveBlock);
  const copyBlock = useStore((state) => state.copyBlock);
  const duplicateBlock = useStore((state) => state.duplicateBlock);
  const addImageBlock = useStore((state) => state.addImageBlock);
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const previewRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);

  // Dropping a picture from the desktop is the fastest way in; it uploads and
  // lands as an image block at the end of the document.
  const onFileDrop = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const uploaded = await uploadImage(file);
    addImageBlock(uploaded.url);
  };

  // Keyboard matches the editor people already know: Delete removes the selected
  // block, arrows walk the document, Escape drops the selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === 'Escape') setMenu(null);
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (selected === null) return;
      if (event.key === 'Escape') {
        select(null);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = selected + (event.key === 'ArrowUp' ? -1 : 1);
        if (next >= 0 && next < doc.blocks.length) {
          select(next);
          blockRefs.current.get(next)?.scrollIntoView({ block: 'nearest' });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, doc.blocks.length, select, removeBlock]);

  useEffect(()=>{
    const root=previewRef.current?.closest('main');if(!root)return;
    const wheel=(event:WheelEvent)=>{if(event.ctrlKey||event.metaKey){event.preventDefault();setZoom(useStore.getState().zoom+(event.deltaY<0?5:-5));}};
    root.addEventListener('wheel',wheel,{passive:false});return()=>root.removeEventListener('wheel',wheel);
  },[setZoom]);

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
  const startInlineEdit = (index: number, clicked: HTMLElement) => {
    const block=doc.blocks[index];
    const container=blockRefs.current.get(index)?.querySelector<HTMLElement>('[data-block-content]');
    if(!block||!container)return;
    let target=clicked.closest<HTMLElement>('p,span,h1,h2,h3,h4,h5,h6,li,td,th,div');
    if(block.kind==='native')target=container.firstElementChild as HTMLElement;
    if(!target||target===container||!container.contains(target)||target.closest('svg:not(:has(foreignObject))'))return;
    const path:number[]=[];let node:Node=target;
    while(node!==container&&node.parentNode){path.unshift(Array.from(node.parentNode.childNodes).indexOf(node as ChildNode));node=node.parentNode;}
    inlineTarget.current={element:target,path};
    if (!target.textContent?.trim() || isPlaceholder(target.textContent || '')) target.replaceChildren();
    target.contentEditable='true';target.focus();
    setEditing({block:index,slot:''});
  };
  const finishInlineEdit = (index:number, _slot:string) => {
    const edited=inlineTarget.current,block=doc.blocks[index];
    if(!edited||!block){setEditing(null);return;}
    const value=cleanHtml(edited.element.innerHTML);
    edited.element.removeAttribute('contenteditable');inlineTarget.current=null;setEditing(null);
    if(block.kind==='native'){updateNative(index,{html:value});return;}
    if(block.html){
      // Update only the edited node; keep original source URLs elsewhere.
      const root=document.createElement('template');root.innerHTML=cleanHtml(block.html);
      let node:Node=root.content;
      for(const part of edited.path){const next=node.childNodes[part];if(!next)return;node=next;}
      if(node instanceof Element){node.innerHTML=value;updateHtml(index,root.innerHTML);}
    } else {const slot=primaryTextSlot(block.matrix);if(slot)updateSlot(index,slot,value);}
  };

  const runMenu = (action: () => void) => {
    action();
    setMenu(null);
  };

  return (
    <main
      className="editor-canvas flex-1 min-w-0 overflow-y-auto"
      onClick={() => setMenu(null)}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files?.length) return;
        event.preventDefault();
        void onFileDrop(event.dataTransfer.files[0]).catch(error=>useStore.setState({message:error.message}));
      }}
    >
      <div className="flex justify-center px-6 py-6">
        <div
          className="w-[430px] shrink-0 transition-transform"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          <div
            ref={previewRef}
            className="rounded-xl shadow-[0_8px_30px_rgba(18,21,28,0.10)] bg-white min-h-[720px] px-5 py-6"
          >
            <ArticleSettings />

            {doc.blocks.length === 0 && (
              <div className="h-[600px] flex flex-col items-center justify-center text-center gap-2 text-ink-600/40">
                <Icon name="template" size={34} />
                <p className="text-[13px]">从左侧点击模板，或使用顶部工具插入基础块</p>
              </div>
            )}

            {doc.blocks.map((block, index) => (
              <div
                data-editor-block={block.id}
                key={block.id}
                ref={(element) => {
                  if (element) blockRefs.current.set(index, element);
                  else blockRefs.current.delete(index);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (editing && editing.block !== index) setEditing(null);
                  select(index,event.metaKey||event.ctrlKey||event.shiftKey);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  startInlineEdit(index, event.target as HTMLElement);
                }}
                onPaste={event => {
                  const target = inlineTarget.current?.element;
                  if (!target?.isContentEditable) return;
                  event.preventDefault(); event.stopPropagation();
                  // Plain text inherits the card's typography, never clipboard colors/backgrounds.
                  const text = event.clipboardData.getData('text/plain');
                  document.execCommand('insertText', false, text);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  select(index);
                  setMenu({ x: event.clientX, y: event.clientY, block: index });
                }}
                onBlur={(event) => {
                  if (editing?.block === index) {
                    const next = event.relatedTarget as HTMLElement | null;
                    if (next && event.currentTarget.contains(next)) return;
                    finishInlineEdit(index, editing.slot);
                  }
                }}
                draggable={!editing}
                onDragStart={(event) => {
                  setDrag({ from: index, over: null });
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                }}
                onDragOver={(event) => {
                  if (!drag || drag.from === index) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (drag.over !== index) setDrag({ ...drag, over: index });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!drag) return;
                  const content=event.currentTarget.querySelector('[data-block-content]');
                  const target=(event.target as HTMLElement).closest('section,td,li,div');
                  if(event.altKey && content && target && content.contains(target) && target!==content){
                    const path:number[]=[];let node:Node=target;
                    while(node!==content&&node.parentNode){path.unshift(Array.from(node.parentNode.childNodes).indexOf(node as ChildNode));node=node.parentNode;}
                    moveInto(drag.from,index,path);
                  } else {moveBlock(drag.from, index);select(index);}
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
                className={`group relative cursor-pointer transition rounded ${
                  (selected === index || selectedIds.includes(block.id)) ? 'block-selected' : 'hover:outline hover:outline-1 hover:outline-accent-400/40'
                } ${drag?.over === index ? 'outline outline-2 outline-accent-500' : ''} ${
                  drag?.from === index ? 'opacity-40' : ''
                }`}
              >
                <div
                  className={`absolute -top-3 right-0 z-10 hidden group-hover:flex items-center gap-1 bg-white border border-mist-200 rounded shadow-sm px-1.5 py-1 ${
                    editing || selected === index ? '!hidden' : ''
                  }`}
                >
                  <button
                    title="上移" disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (index > 0) {
                        moveBlock(index, index - 1);
                        select(index - 1);
                      }
                    }}
                    className="block-tool text-ink-600 hover:text-ink-900"
                  >
                    <Icon name="arrow" size={16} style={{ transform: 'rotate(90deg)' }} />
                  </button>
                  <button
                    title="下移" disabled={index === doc.blocks.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (index < doc.blocks.length - 1) {
                        moveBlock(index, index + 1);
                        select(index + 1);
                      }
                    }}
                    className="block-tool text-ink-600 hover:text-ink-900"
                  >
                    <Icon name="arrow" size={16} style={{ transform: 'rotate(-90deg)' }} />
                  </button>
                  <button
                    title="复制"
                    onClick={(event) => {
                      event.stopPropagation();
                      duplicateBlock(index);
                    }}
                    className="block-tool text-ink-600 hover:text-ink-900"
                  >
                    <Icon name="copy" size={16} />
                  </button>
                  <button
                    title="删除"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeBlock(index);
                    }}
                    className="block-tool block-tool-delete text-ink-600 hover:text-red-600"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                <div
                  data-block-content
                  onClick={event => { if((event.target as HTMLElement).closest('a'))event.preventDefault(); }}
                  dangerouslySetInnerHTML={{ __html: previews[block.id] ?? '' }}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 mt-3 text-[11px] text-ink-600/50">
            <span>{doc.blocks.length} 个块</span>
            <span className="text-ink-600/20">|</span>
            <button aria-label="缩小画布" onClick={() => setZoom(zoom - 10)} className="px-1 hover:text-ink-900">
              −
            </button>
            <span className="w-10 text-center">{zoom}%</span>
            <button aria-label="放大画布" onClick={() => setZoom(zoom + 10)} className="px-1 hover:text-ink-900">
              +
            </button>
            <button onClick={() => setZoom(100)} className="px-1 hover:text-ink-900" title="复位">
              复位
            </button>
          </div>
        </div>
      </div>

      <BlockToolbar />
      {menu && (
        <div
          className="canvas-context-menu fixed z-40 w-[164px] py-1 rounded-lg border border-mist-200 bg-white shadow-xl text-[12px] text-ink-800"
          style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 180)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 210)) }}
          onClick={(event) => event.stopPropagation()}
        >
          {[
            { label: '复制到剪贴板', hint: 'Ctrl/Cmd+C', run: () => copyBlock(menu.block) },
            { label: '原地复一份', hint: 'Ctrl+D', run: () => duplicateBlock(menu.block) },
            { label: '前插空行', hint: '', run: () => addNative('text', menu.block) },
            { label: '后插空行', hint: '', run: () => addNative('text', menu.block + 1) },
            { label: '删除', hint: 'Del', run: () => removeBlock(menu.block), danger: true },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => runMenu(item.run)}
              className={`w-full px-3 py-1.5 flex items-center justify-between hover:bg-mist-100 ${
                item.danger ? 'text-red-600' : ''
              }`}
            >
              <span>{item.label}</span>
              <span className="text-[10px] text-ink-600/40">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
