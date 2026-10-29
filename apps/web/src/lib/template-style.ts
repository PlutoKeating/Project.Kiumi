import { sanitizeHtml } from '@kiumi/core';

export const isPlaceholder = (text: string) => /^(?:(?:请)?输入(?:文字|文本|正文|标题)|请输入内容|点击(?:这里)?输入(?:文字|内容)|[\s\u00a0，。:：…])+$/u.test(text.trim());

/** Placeholder labels live in editor CSS, never in the article's text. */
export function prepareTemplate(html: string): string {
  const root = document.createElement('template'); root.innerHTML = sanitizeHtml(html);
  const walker = document.createTreeWalker(root.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim() && isPlaceholder(n.textContent)) nodes.push(n as Text);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (parent && !parent.closest('svg')) {
      node.textContent = '';
      parent.setAttribute('data-kiumi-placeholder', '双击输入内容');
    }
  }
  return root.innerHTML;
}

/** Retain semantic content, replacing the source card's layout and typography. */
export function transplantStyle(source: string, template: string): string {
  const content = document.createElement('template'); content.innerHTML = prepareTemplate(source);
  for (const el of [...content.content.querySelectorAll('*')].reverse()) {
    if (el.closest('svg')) continue;
    if (el.hasAttribute('data-kiumi-placeholder') && !el.textContent?.trim()) { el.remove(); continue; }
    el.removeAttribute('style'); el.removeAttribute('class'); el.removeAttribute('id');
    el.removeAttribute('data-kiumi-placeholder');
    if (['SECTION','DIV','SPAN','FONT','CENTER'].includes(el.tagName)) el.replaceWith(...el.childNodes);
    else if (el.tagName === 'IMG') el.setAttribute('style','max-width:100%;height:auto');
    else if (el.tagName === 'TABLE') el.setAttribute('style','width:100%;border-collapse:collapse;table-layout:fixed');
    else if (['TD','TH'].includes(el.tagName)) el.setAttribute('style','border:1px solid currentColor;padding:6px;overflow-wrap:anywhere');
    else if (/^P$|^H[1-6]$/.test(el.tagName)) el.setAttribute('style','font-family:inherit;font-size:inherit;color:inherit;line-height:inherit;margin:0 0 0.75em');
  }
  const target = document.createElement('template'); target.innerHTML = sanitizeHtml(template);
  // Prefer the longest paragraph (the body slot), avoiding short decorative labels.
  const candidates = [...target.content.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6')].filter(el => !el.closest('svg') && el.textContent?.trim());
  if (!candidates.length) candidates.push(...[...target.content.querySelectorAll<HTMLElement>('span,section,div')].filter(el => !el.closest('svg') && el.textContent?.trim() && !el.querySelector('p,section,div,span,img,table')));
  const slot = candidates.sort((a,b)=>(b.textContent?.length || 0)-(a.textContent?.length || 0))[0];
  if (!slot) throw new Error('此模板没有可承载正文的文字区域，请选择文字卡片模板。');
  // Keep typography authored on spans inside the chosen paragraph.
  const styleSource = slot.querySelector<HTMLElement>('span[style]');
  const wrapper = document.createElement('div'); wrapper.style.cssText = slot.style.cssText;
  if (styleSource) for (const name of ['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align']) {
    const value = styleSource.style.getPropertyValue(name); if (value) wrapper.style.setProperty(name,value);
  }
  const walker = document.createTreeWalker(target.content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest('svg')) node.textContent = '';
  wrapper.innerHTML = content.innerHTML; slot.replaceWith(wrapper);
  for (let parent: HTMLElement | null = wrapper; parent; parent = parent.parentElement) {
    if (parent.style.height) parent.style.height = 'auto';
    if (parent.style.maxHeight) parent.style.maxHeight = 'none';
    if (parent.style.overflow === 'hidden') parent.style.overflow = 'visible';
  }
  return sanitizeHtml(target.innerHTML);
}
