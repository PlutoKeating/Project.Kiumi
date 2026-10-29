import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.ts';
import { copyRichHtml, renderDocument } from '../api.ts';
import { editBlock, styleBlock } from '../lib/block-edit.ts';
import { Icon } from './Icon.tsx';

function Menu({ label, children, icon }: { label: string; children: ReactNode; icon?: ReactNode }) {
  return <details className="tool-menu"><summary title={label}>{icon}{label}<Icon name="chevron" size={12} /></summary><div className="tool-popover">{children}</div></details>;
}
function NumberField({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit?: string; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return <label className="tool-field"><span>{label}</span><span><input aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={e => { if (e.target.value !== '') onChange(Math.min(max, Math.max(min, Number(e.target.value)))); }} />{unit && <small>{unit}</small>}</span></label>;
}

export function BlockToolbar() {
  const selected = useStore(s => s.selected), doc = useStore(s => s.doc), previews = useStore(s => s.previews);
  const favoriteBlocks = useStore(s => s.favoriteBlocks), formatBrush = useStore(s => s.formatBrush);
  const block = selected === null ? null : doc.blocks[selected];
  const [pinned, setPinned] = useState(false), [position, setPosition] = useState({ left: 0, top: 0, width: 600, visible: false });
  const [replace, setReplace] = useState(''), [replacement, setReplacement] = useState('');
  const [imageWidth, setImageWidth] = useState(100), [imageRadius, setImageRadius] = useState(0);
  const [notice, setNotice] = useState('');
  const toolbar = useRef<HTMLDivElement>(null);
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
      const area = canvas.getBoundingClientRect(), rect = target.getBoundingClientRect();
      const width = Math.min(710, area.width - 24), height = toolbar.current?.offsetHeight || 106;
      const top = pinned ? area.top + 12 : Math.min(area.bottom - height - 12, Math.max(area.top + 12, rect.top - height - 12));
      setPosition({ width, left: Math.max(area.left + 12, Math.min(rect.left, area.right - width - 12)), top, visible: pinned || (rect.bottom > area.top && rect.top < area.bottom) });
    };
    place(); window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    const observer = new ResizeObserver(place); if (toolbar.current) observer.observe(toolbar.current);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); observer.disconnect(); };
  }, [block?.id, html, pinned]);
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
  return createPortal(<div ref={toolbar} className={`block-toolbar ${position.top > window.innerHeight / 2 ? 'popover-above' : ''}`} role="toolbar" aria-label="内容块工具栏" style={{ left: position.left, top: position.top, width: position.width, visibility: position.visible ? 'visible' : 'hidden', '--popover-height': `${Math.max(120, position.top > window.innerHeight / 2 ? position.top - 24 : window.innerHeight - position.top - (toolbar.current?.offsetHeight || 106) - 24)}px` } as CSSProperties} onClick={e => e.stopPropagation()} onToggle={e => {
    const current = e.target as HTMLDetailsElement;
    if (current.open) toolbar.current?.querySelectorAll('details[open]').forEach(el => { if (el !== current) el.removeAttribute('open'); });
  }}>
    <div className="toolbar-row">
      <button title={pinned ? '取消固定工具栏' : '固定工具栏'} aria-pressed={pinned} onClick={() => setPinned(!pinned)}><Icon name="pin" /></button>
      <Menu label="复制" icon={<Icon name="copy" />}><button onClick={() => state().copyBlock(selected)}>复制到块剪贴板</button><button onClick={() => state().duplicateBlock(selected)}>原地复制一份</button><button onClick={() => void copyWechat()}>复制到微信</button></Menu>
      <button title="删除内容块" onClick={() => state().removeBlock(selected)}><Icon name="trash" /></button>
      <button aria-pressed={favoriteBlocks.some(item => item.id === block.id)} onClick={() => state().toggleBlockFavorite(block)}><Icon name="star" />收藏</button>
      <Menu label="变换组件"><button onClick={() => {
        window.dispatchEvent(new CustomEvent('kiumi:templates')); setNotice('在左侧选择模板并点击「应用样式」，保留内容换外观');
      }}>从模板库应用样式</button>{(['text', 'heading', 'quote'] as const).map(kind => <button key={kind} onClick={() => editBlock(selected, root => {
        const next = document.createElement(kind === 'text' ? 'p' : kind === 'heading' ? 'h2' : 'blockquote');
        next.textContent = root.content.textContent; root.content.replaceChildren(next);
      })}>{kind === 'text' ? '转为正文' : kind === 'heading' ? '转为标题' : '转为引用'}</button>)}</Menu>
      <Menu label="插入空行"><button onClick={() => { state().addNative('text', selected); state().updateNative(selected, { text: '', html: '<br>' }); }}>前插空行</button><button onClick={() => { state().addNative('text', selected + 1); state().updateNative(selected + 1, { text: '', html: '<br>' }); }}>后插空行</button></Menu>
      <button title="格式刷：先取格式，再选中目标块刷格式" onClick={() => { if (state().formatBrush) state().brushFormat(selected); else state().takeFormat(selected); }}><Icon name="brush" /></button>
      <Menu label="更多" icon={<Icon name="more" />}>
        <NumberField label="不透明度" value={Math.round(number('opacity', 1, true) * 100)} min={0} max={100} unit="%" onChange={n => apply('opacity', String(n / 100), false)} />
        <NumberField label="旋转" value={transformNumber('rotate', 0)} min={-180} max={180} unit="°" onChange={n => transform('rotate', `${n}deg`)} />
        <div className="tool-pair"><button onClick={() => transform('scaleY', String(-transformNumber('scaleY', 1)))}>上下翻转</button><button onClick={() => transform('scaleX', String(-transformNumber('scaleX', 1)))}>左右翻转</button></div>
        <label className="tool-check"><input type="checkbox" checked={css('-webkit-box-reflect', '', true) !== ''} onChange={e => apply('-webkit-box-reflect', e.target.checked ? 'below 0px linear-gradient(transparent 10%, rgba(0,0,0,.2))' : '', false)} />倒影</label>
        <NumberField label="倒影间距" value={parseFloat(css('-webkit-box-reflect', '', true).match(/below\s+([\d.]+)/)?.[1] ?? '0')} min={0} max={100} unit="px" onChange={n => apply('-webkit-box-reflect', `below ${n}px linear-gradient(transparent 10%, rgba(0,0,0,.2))`, false)} />
        <NumberField label="倒影隐藏" value={parseFloat(css('-webkit-box-reflect', '', true).match(/transparent\s+([\d.]+)/)?.[1] ?? '10')} min={0} max={100} unit="%" onChange={n => apply('-webkit-box-reflect', `below ${parseFloat(css('-webkit-box-reflect', '', true).match(/below\s+([\d.]+)/)?.[1] ?? '0')}px linear-gradient(transparent ${n}%, rgba(0,0,0,.2))`, false)} />
        <p className="tool-note">倒影在支持的浏览器显示，发布前请检查微信预览。</p>
        <button onClick={() => void copyWechat()}>复制到微信</button>
        <label className="tool-stack">替换文字<input aria-label="查找文字" placeholder="查找文字" value={replace} onChange={e => setReplace(e.target.value)} /><input aria-label="替换为" placeholder="替换为" value={replacement} onChange={e => setReplacement(e.target.value)} /></label>
        <button disabled={!replace} onClick={() => { let count = 0; editBlock(selected, root => { const walker = document.createTreeWalker(root.content, NodeFilter.SHOW_TEXT); for (let node = walker.nextNode(); node; node = walker.nextNode()) { if (node.nodeValue?.includes(replace)) { count++; node.nodeValue = node.nodeValue.split(replace).join(replacement); } } }); setNotice(count ? `已替换 ${count} 处文字` : '未找到匹配文字'); }}>替换选中块文字</button>
        <button onClick={() => editBlock(selected, root => { root.content.querySelectorAll('a').forEach(a => a.replaceWith(...a.childNodes)); })}>清除链接</button>
        <div className="tool-divider" />
        <strong>图片批处理</strong>
        <NumberField label="图片宽度" value={imageWidth} min={1} max={100} unit="%" onChange={setImageWidth} />
        <NumberField label="图片圆角" value={imageRadius} min={0} max={100} unit="px" onChange={setImageRadius} />
        <button disabled={!source.content.querySelector('img')} onClick={() => editBlock(selected, root => { root.content.querySelectorAll('img').forEach(img => { img.style.width = `${imageWidth}%`; img.style.maxWidth = '100%'; img.style.borderRadius = `${imageRadius}px`; }); })}>应用到块内全部图片</button>
      </Menu>
      <button title="组件定位" onClick={() => document.querySelector(`[data-editor-block="${CSS.escape(block.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}><Icon name="locate" /></button>
    </div>
    <div className="toolbar-row">
      <select aria-label="字体" value={css('font-family', '').includes('serif') && !css('font-family', '').includes('sans-serif') ? 'serif' : css('font-family', '').includes('monospace') ? 'monospace' : 'sans-serif'} onChange={e => apply('font-family', e.target.value)}><option value="sans-serif">默认字体</option><option value="serif">宋体 / 衬线</option><option value="monospace">等宽字体</option></select>
      <input className="font-size" aria-label="字号" type="number" min={8} max={96} value={number('font-size', 16)} onChange={e => { if (e.target.value) apply('font-size', `${Math.max(8, Math.min(96, Number(e.target.value)))}px`); }} />
      <input aria-label="文字颜色" title="文字颜色" type="color" value={/^#[\da-f]{6}$/i.test(css('color', '')) ? css('color', '') : '#3f3f3f'} onChange={e => apply('color', e.target.value)} />
      <Menu label="对齐" icon={<Icon name="align" />}>{[['left','向左对齐'],['center','居中对齐'],['right','向右对齐'],['justify','两端对齐']].map(([value,label]) => <button aria-pressed={css('text-align', 'left') === value} key={value} onClick={() => apply('text-align', value!)}>{label}</button>)}</Menu>
      <button aria-label="加粗" aria-pressed={['bold','700'].includes(css('font-weight', ''))} onClick={() => toggle('font-weight', 'bold', 'normal')}><b>B</b></button>
      <button aria-label="斜体" aria-pressed={css('font-style', '') === 'italic'} onClick={() => toggle('font-style', 'italic', 'normal')}><i>I</i></button>
      <Menu label="装饰"><button onClick={() => toggle('text-decoration', 'underline', 'none')}>下划线</button><button onClick={() => toggle('text-decoration', 'line-through', 'none')}>删除线</button><button onClick={() => apply('text-decoration', 'none')}>清除装饰</button></Menu>
      <Menu label="格式"><button onClick={() => state().takeFormat(selected)}>复制格式</button><button disabled={!formatBrush} onClick={() => state().brushFormat(selected)}>粘贴格式</button><button onClick={() => state().clearFormat()}>取消格式刷</button><button onClick={() => editBlock(selected, root => { for (const node of root.content.querySelectorAll<HTMLElement>('*')) for (const name of ['font-size','font-family','font-weight','font-style','color','text-align','line-height','letter-spacing','text-decoration','text-indent']) node.style.removeProperty(name); })}>清除文字格式</button><button onClick={() => apply('text-indent', css('text-indent', '') === '2em' ? '0' : '2em')}>首行缩进</button><label className="tool-field">文字底色<input aria-label="文字底色" type="color" defaultValue="#f2e7dc" onChange={e => apply('background-color', e.target.value)} /></label></Menu>
      <Menu label="间距"><NumberField label="行间距" value={number('line-height', 1.6)} min={0.5} max={5} step={0.1} unit="倍" onChange={n => apply('line-height', String(n))} /><NumberField label="字间距" value={number('letter-spacing', 0)} min={-5} max={30} unit="px" onChange={n => apply('letter-spacing', `${n}px`)} /><NumberField label="段落间距" value={number('margin-bottom', 0)} min={0} max={150} unit="px" onChange={n => apply('margin-bottom', `${n}px`)} /><NumberField label="左右边距" value={number('padding-left', 0, true)} min={0} max={100} unit="px" onChange={n => editBlock(selected, root => { const node = root.content.firstElementChild as HTMLElement; if (node) { node.style.paddingLeft = `${n}px`; node.style.paddingRight = `${n}px`; } })} /></Menu>
    </div>
    {notice && <div className="toolbar-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
  </div>, document.body);
}
