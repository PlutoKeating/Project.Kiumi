import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.ts';
import { copyRichHtml, renderDocument } from '../api.ts';
import { editBlock, styleBlock } from '../lib/block-edit.ts';
import { layoutRect, layoutViewport, uiScale } from '../lib/ui-scale.ts';
import { Icon } from './Icon.tsx';
import { ColorPicker, Select } from './ui.tsx';

function Menu({ label, children, icon, align = 'start', wide = false }: { label: string; children: ReactNode; icon: ReactNode; align?: 'start' | 'end'; wide?: boolean }) {
  return <details className="tool-menu" data-align={align} data-wide={wide}><summary aria-label={label} data-tip={label}>{icon}<Icon name="chevron" size={12} /></summary><div className="tool-popover">{children}</div></details>;
}
function NumberField({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit?: string; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return <label className="tool-field"><span>{label}</span><span><input aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={e => { if (e.target.value !== '') onChange(Math.min(max, Math.max(min, Number(e.target.value)))); }} />{unit && <small>{unit}</small>}</span></label>;
}

const ALIGNMENTS = [['left', '向左对齐', 'alignLeft'], ['center', '居中对齐', 'alignCenter'], ['right', '向右对齐', 'alignRight'], ['justify', '两端对齐', 'alignJustify']] as const;

const TOP_CLEARANCE = 70, BOTTOM_CLEARANCE = 84;

export function BlockToolbar() {
  const selected = useStore(s => s.selected), doc = useStore(s => s.doc), previews = useStore(s => s.previews);
  const favoriteBlocks = useStore(s => s.favoriteBlocks), formatBrush = useStore(s => s.formatBrush);
  const block = selected === null ? null : doc.blocks[selected];
  const [pinned, setPinned] = useState(false), [position, setPosition] = useState({ left: 0, top: 0, width: 0, visible: false });
  const [replace, setReplace] = useState(''), [replacement, setReplacement] = useState('');
  const [imageWidth, setImageWidth] = useState(100), [imageRadius, setImageRadius] = useState(0);
  const [notice, setNotice] = useState('');
  const toolbar = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(false); // Glide between blocks, but never fly in on first appearance.
  const html = block ? previews[block.id] ?? '' : '';
  const source = document.createElement('template'); source.innerHTML = html;
  const first = source.content.firstElementChild as HTMLElement | null;
  const text = source.content.querySelector<HTMLElement>('p,h1,h2,h3,span,li') ?? first;
  const css = (name: string, fallback: string, whole = false) => (whole ? first : text)?.style.getPropertyValue(name) || first?.style.getPropertyValue(name) || fallback;
  const number = (name: string, fallback: number, whole = false) => parseFloat(css(name, String(fallback), whole)) || 0;
  const apply = (name: string, value: string, text = true) => { if (selected !== null) styleBlock(selected, name, value, text); };
  const state = () => useStore.getState();

  useLayoutEffect(() => {
    if (!block) return;
    const place = () => {
      const canvas = document.querySelector('.editor-canvas');
      const target = document.querySelector(`[data-editor-block="${CSS.escape(block.id)}"]`);
      if (!canvas || !target) return;
      const area = layoutRect(canvas), rect = layoutRect(target);
      const width = toolbar.current?.offsetWidth || 600, height = toolbar.current?.offsetHeight || 56;
      const ceiling = area.top + TOP_CLEARANCE, floor = area.bottom - height - BOTTOM_CLEARANCE;
      // Never cover the article title: above the block, else below it, else tucked inside its top edge.
      const titleNode = document.querySelector('.paper-title'), title = titleNode && layoutRect(titleNode);
      const safe = title && title.bottom > ceiling ? title.bottom + 6 : ceiling;
      const above = rect.top - height - 12, below = rect.bottom + 12;
      const top = pinned ? safe : above >= safe ? Math.min(above, floor) : below <= floor ? below : Math.min(floor, Math.max(safe, rect.top + 8));
      const left = Math.max(area.left + 12, Math.min(rect.left + rect.width / 2 - width / 2, area.right - width - 12));
      setPosition({ width, left, top, visible: pinned || (rect.bottom > area.top + TOP_CLEARANCE && rect.top < area.bottom - BOTTOM_CLEARANCE) });
    };
    place(); window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    const observer = new ResizeObserver(place); if (toolbar.current) observer.observe(toolbar.current);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); observer.disconnect(); };
  }, [block?.id, html, pinned]);
  // A block taller than the room around it would be cut by the toolbar: bring its top into the clear.
  useLayoutEffect(() => {
    if (!block || pinned) return;
    const canvas = document.querySelector('.editor-canvas'), target = document.querySelector(`[data-editor-block="${CSS.escape(block.id)}"]`);
    if (!canvas || !target) return;
    const area = layoutRect(canvas), rect = layoutRect(target), height = toolbar.current?.offsetHeight || 56;
    const titleNode = document.querySelector('.paper-title'), title = titleNode && layoutRect(titleNode);
    const above = rect.top - height - 12, ceiling = area.top + TOP_CLEARANCE, safe = title && title.bottom > ceiling ? title.bottom + 6 : ceiling;
    if (above < safe && rect.bottom + 12 > area.bottom - BOTTOM_CLEARANCE - height) canvas.scrollBy({ top: (above - ceiling) * uiScale() });
  }, [block?.id, pinned]);
  const present = block !== null;
  useEffect(() => {
    if (!present) { setSettled(false); return; }
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    return () => cancelAnimationFrame(frame);
  }, [present]);
  useEffect(() => {
    setNotice('');
    toolbar.current?.querySelectorAll('details[open]').forEach(el => el.removeAttribute('open'));
  }, [block?.id]);
  useEffect(() => {
    const dismiss = (event: Event) => { if (!toolbar.current?.contains(event.target as Node)) toolbar.current?.querySelectorAll('details[open]').forEach(el => el.removeAttribute('open')); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const open = toolbar.current?.querySelectorAll<HTMLDetailsElement>('details[open]');
      if (!open?.length) return;
      event.preventDefault(); event.stopPropagation();
      open.forEach(el => { el.open = false; el.querySelector('summary')?.focus(); });
    };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  if (!block || selected === null) return null;
  const copyWechat = async () => {
    try { await copyRichHtml((await renderDocument({ ...state().doc, blocks: [state().doc.blocks[selected]!] })).html); setNotice('已复制，可粘贴到公众号'); }
    catch (error) { setNotice(`复制失败：${(error as Error).message}`); }
  };
  const toggle = (name: string, enabled: string, disabled: string) => apply(name, css(name, disabled) === enabled ? disabled : enabled);
  const transform = (key: string, value: string) => {
    const current = css('transform', '', true).replace(new RegExp(`${key}\\([^)]*\\)`, 'g'), '').trim();
    apply('transform', `${current} ${key}(${value})`.trim(), false);
  };
  const transformNumber = (key: string, fallback: number) => Number(css('transform', '', true).match(new RegExp(`${key}\\((-?[\\d.]+)`))?.[1] ?? fallback);
  const barHeight = toolbar.current?.offsetHeight || 56;
  const roomAbove = position.top - TOP_CLEARANCE - 12, roomBelow = layoutViewport().height - position.top - barHeight - 24;
  const openUp = roomAbove > roomBelow;
  const popHeight = Math.max(160, openUp ? roomAbove : roomBelow);
  const align = css('text-align', 'left');
  const textColor = /^#[\da-f]{6}$/i.test(css('color', '')) ? css('color', '') : '#3f3f3f';
  const alignIcon = ALIGNMENTS.find(([value]) => value === align)?.[2] ?? 'alignLeft';
  return createPortal(<div ref={toolbar} className={`block-toolbar ${openUp ? 'popover-above' : ''}`} data-settled={settled} role="toolbar" aria-label="内容块工具栏" style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden', '--popover-height': `${popHeight}px` } as CSSProperties} onClick={e => e.stopPropagation()} onToggle={e => {
    const current = e.target as HTMLDetailsElement;
    if (current.open) toolbar.current?.querySelectorAll('details[open]').forEach(el => { if (el !== current) el.removeAttribute('open'); });
  }}>
    <div className="toolbar-row">
      <Select variant="chip" label="字体" value={css('font-family', '').includes('serif') && !css('font-family', '').includes('sans-serif') ? 'serif' : css('font-family', '').includes('monospace') ? 'monospace' : 'sans-serif'} onChange={value => apply('font-family', value)} options={[{ value: 'sans-serif', label: '默认' }, { value: 'serif', label: '宋体' }, { value: 'monospace', label: '等宽' }]} />
      <input className="font-size" aria-label="字号" data-tip="字号" type="number" min={8} max={96} value={number('font-size', 16)} onChange={e => { if (e.target.value) apply('font-size', `${Math.max(8, Math.min(96, Number(e.target.value)))}px`); }} />
      <Menu label="文字颜色" icon={<span className="color-dot" style={{ background: textColor }} />}><ColorPicker label="文字颜色" value={textColor} onChange={color => apply('color', color)} /></Menu>
      <button type="button" aria-label="加粗" data-tip="加粗" aria-pressed={['bold','700'].includes(css('font-weight', ''))} onClick={() => toggle('font-weight', 'bold', 'normal')}><b>B</b></button>
      <button type="button" aria-label="斜体" data-tip="斜体" aria-pressed={css('font-style', '') === 'italic'} onClick={() => toggle('font-style', 'italic', 'normal')}><i>I</i></button>
      <Menu label="对齐" icon={<Icon name={alignIcon} />}>{ALIGNMENTS.map(([value, label, icon]) => <button type="button" aria-pressed={align === value} key={value} onClick={() => apply('text-align', value)}><Icon name={icon} size={16} />{label}</button>)}</Menu>
      <Menu label="间距" icon={<Icon name="spacing" />}><NumberField label="行间距" value={number('line-height', 1.6)} min={0.5} max={5} step={0.1} unit="倍" onChange={n => apply('line-height', String(n))} /><NumberField label="字间距" value={number('letter-spacing', 0)} min={-5} max={30} unit="px" onChange={n => apply('letter-spacing', `${n}px`)} /><NumberField label="段落间距" value={number('margin-bottom', 0)} min={0} max={150} unit="px" onChange={n => apply('margin-bottom', `${n}px`)} /><NumberField label="左右边距" value={number('padding-left', 0, true)} min={0} max={100} unit="px" onChange={n => editBlock(selected, root => { const node = root.content.firstElementChild as HTMLElement; if (node) { node.style.paddingLeft = `${n}px`; node.style.paddingRight = `${n}px`; } })} /></Menu>
      <Menu label="文字格式" icon={<Icon name="type" />}>
        <button type="button" onClick={() => toggle('text-decoration', 'underline', 'none')}>下划线</button><button type="button" onClick={() => toggle('text-decoration', 'line-through', 'none')}>删除线</button><button type="button" onClick={() => apply('text-decoration', 'none')}>清除装饰</button>
        <button type="button" onClick={() => apply('text-indent', css('text-indent', '') === '2em' ? '0' : '2em')}>首行缩进</button>
        <div className="tool-divider" />
        <strong>文字底色</strong>
        <ColorPicker label="文字底色" value={/^#[\da-f]{6}$/i.test(css('background-color', '')) ? css('background-color', '') : '#ffe7f1'} onChange={color => apply('background-color', color)} />
        <div className="tool-divider" />
        <button type="button" onClick={() => state().takeFormat(selected)}>复制格式</button><button type="button" disabled={!formatBrush} onClick={() => state().brushFormat(selected)}>粘贴格式</button><button type="button" disabled={!formatBrush} onClick={() => state().clearFormat()}>取消格式刷</button>
        <button type="button" onClick={() => editBlock(selected, root => { for (const node of root.content.querySelectorAll<HTMLElement>('*')) for (const name of ['font-size','font-family','font-weight','font-style','color','text-align','line-height','letter-spacing','text-decoration','text-indent']) node.style.removeProperty(name); })}>清除文字格式</button>
      </Menu>
      <span className="toolbar-rule" />
      <button type="button" aria-label="格式刷" data-tip={formatBrush ? '点目标块刷上格式' : '格式刷：先取格式'} aria-pressed={Boolean(formatBrush)} onClick={() => { if (state().formatBrush) state().brushFormat(selected); else state().takeFormat(selected); }}><Icon name="brush" /></button>
      <Menu label="变换组件" icon={<Icon name="change" />} align="end"><button type="button" onClick={() => {
        window.dispatchEvent(new CustomEvent('kiumi:templates')); setNotice('在左侧模板卡片上点「换样式」，保留内容换外观');
      }}>从模板库换样式</button>{(['text', 'heading', 'quote'] as const).map(kind => <button type="button" key={kind} onClick={() => editBlock(selected, root => {
        const next = document.createElement(kind === 'text' ? 'p' : kind === 'heading' ? 'h2' : 'blockquote');
        next.textContent = root.content.textContent; root.content.replaceChildren(next);
      })}>{kind === 'text' ? '转为正文' : kind === 'heading' ? '转为标题' : '转为引用'}</button>)}</Menu>
      <Menu label="复制" icon={<Icon name="copy" />} align="end"><button type="button" onClick={() => state().copyBlock(selected)}>复制到块剪贴板</button><button type="button" onClick={() => state().duplicateBlock(selected)}>原地复制一份</button><button type="button" onClick={() => void copyWechat()}>复制到微信</button></Menu>
      <button type="button" aria-label="收藏" data-tip="收藏内容与样式" data-tone="blush" aria-pressed={favoriteBlocks.some(item => item.id === block.id)} onClick={() => state().toggleBlockFavorite(block)}><Icon name="star" /></button>
      <button type="button" aria-label="删除内容块" data-tip="删除" className="is-danger" onClick={() => state().removeBlock(selected)}><Icon name="trash" /></button>
      <Menu label="更多" icon={<Icon name="more" />} align="end" wide>
        <button type="button" onClick={() => { state().addNative('text', selected); state().updateNative(selected, { text: '', html: '<br>' }); }}>前插空行</button><button type="button" onClick={() => { state().addNative('text', selected + 1); state().updateNative(selected + 1, { text: '', html: '<br>' }); }}>后插空行</button>
        <button type="button" onClick={() => document.querySelector(`[data-editor-block="${CSS.escape(block.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>定位到这一块</button>
        <button type="button" onClick={() => editBlock(selected, root => { root.content.querySelectorAll('a').forEach(a => a.replaceWith(...a.childNodes)); })}>清除链接</button>
        <div className="tool-divider" />
        <strong>外观效果</strong>
        <NumberField label="不透明度" value={Math.round(number('opacity', 1, true) * 100)} min={0} max={100} unit="%" onChange={n => apply('opacity', String(n / 100), false)} />
        <NumberField label="旋转" value={transformNumber('rotate', 0)} min={-180} max={180} unit="°" onChange={n => transform('rotate', `${n}deg`)} />
        <button type="button" onClick={() => transform('scaleY', String(-transformNumber('scaleY', 1)))}>上下翻转</button><button type="button" onClick={() => transform('scaleX', String(-transformNumber('scaleX', 1)))}>左右翻转</button>
        <label className="tool-check"><input type="checkbox" checked={css('-webkit-box-reflect', '', true) !== ''} onChange={e => apply('-webkit-box-reflect', e.target.checked ? 'below 0px linear-gradient(transparent 10%, rgba(0,0,0,.2))' : '', false)} />倒影</label>
        <NumberField label="倒影间距" value={parseFloat(css('-webkit-box-reflect', '', true).match(/below\s+([\d.]+)/)?.[1] ?? '0')} min={0} max={100} unit="px" onChange={n => apply('-webkit-box-reflect', `below ${n}px linear-gradient(transparent 10%, rgba(0,0,0,.2))`, false)} />
        <NumberField label="倒影隐藏" value={parseFloat(css('-webkit-box-reflect', '', true).match(/transparent\s+([\d.]+)/)?.[1] ?? '10')} min={0} max={100} unit="%" onChange={n => apply('-webkit-box-reflect', `below ${parseFloat(css('-webkit-box-reflect', '', true).match(/below\s+([\d.]+)/)?.[1] ?? '0')}px linear-gradient(transparent ${n}%, rgba(0,0,0,.2))`, false)} />
        <p className="tool-note">倒影在支持的浏览器显示，发布前请检查微信预览。</p>
        <div className="tool-divider" />
        <strong>替换文字</strong>
        <div className="tool-stack"><input className="field" aria-label="查找文字" placeholder="查找文字" value={replace} onChange={e => setReplace(e.target.value)} /><input className="field" aria-label="替换为" placeholder="替换为" value={replacement} onChange={e => setReplacement(e.target.value)} /></div>
        <button type="button" className="tool-wide" disabled={!replace} onClick={() => { let count = 0; editBlock(selected, root => { const walker = document.createTreeWalker(root.content, NodeFilter.SHOW_TEXT); for (let node = walker.nextNode(); node; node = walker.nextNode()) { if (node.nodeValue?.includes(replace)) { count++; node.nodeValue = node.nodeValue.split(replace).join(replacement); } } }); setNotice(count ? `已替换 ${count} 处文字` : '未找到匹配文字'); }}>替换选中块文字</button>
        <div className="tool-divider" />
        <strong>图片批处理</strong>
        <NumberField label="图片宽度" value={imageWidth} min={1} max={100} unit="%" onChange={setImageWidth} />
        <NumberField label="图片圆角" value={imageRadius} min={0} max={100} unit="px" onChange={setImageRadius} />
        <button type="button" className="tool-wide" disabled={!source.content.querySelector('img')} onClick={() => editBlock(selected, root => { root.content.querySelectorAll('img').forEach(img => { img.style.width = `${imageWidth}%`; img.style.maxWidth = '100%'; img.style.borderRadius = `${imageRadius}px`; }); })}>应用到块内全部图片</button>
      </Menu>
      <button type="button" aria-label={pinned ? '取消固定工具栏' : '固定工具栏'} data-tip={pinned ? '取消固定' : '固定到顶部'} aria-pressed={pinned} onClick={() => setPinned(!pinned)}><Icon name="pin" /></button>
    </div>
    {notice && <div className="toolbar-notice" role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
  </div>, document.body);
}
