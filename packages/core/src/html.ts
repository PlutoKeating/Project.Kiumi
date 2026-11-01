import { parse } from 'node-html-parser';

/** Preserve article/SVG structure, but never execute template or pasted code. */
export function sanitizeHtml(html: string): string {
  const root = parse(html, { comment: false });
  for (const node of root.querySelectorAll('script,iframe,object,embed,link,style,meta,base,form,input,textarea,select,button')) node.remove();
  for (const node of root.querySelectorAll('*')) {
    if (/^(animate|set)/i.test(node.tagName) && /^(on|href|xlink:href|src)/i.test(node.getAttribute('attributeName') ?? '')) {node.remove();continue;}
    for (const [name, value] of Object.entries(node.attributes)) {
      const key=name.toLowerCase(), compact=value.replace(/[\s\u0000-\u001f]+/g,'');
      if (key.startsWith('on') || key === 'srcdoc' || ((key==='href' || key==='xlink:href' || key==='src' || key==='action') && /^(javascript|vbscript|data:text|data:application):/i.test(compact)) || (key==='style' && /expression\(|javascript:|vbscript:|-moz-binding|behavior:/i.test(compact))) node.removeAttribute(name);
    }
  }
  return root.toString();
}

const TEXT_BLOCK = new Set([
  'P','H1','H2','H3','H4','H5','H6','LI','TD','TH','BLOCKQUOTE','FIGCAPTION',
  'A','BUTTON','DIV','SECTION','ARTICLE','HEADER','FOOTER','SVG','TEXT',
]);

function textBlockOf(node: any): any {
  let current = node;
  while (current) {
    const tag = String(current.tagName ?? '').toUpperCase();
    if (TEXT_BLOCK.has(tag)) return current;
    current = current.parentNode;
  }
  return node;
}

function placeholderFor(tag: string): string {
  const name = tag.toUpperCase();
  if (/^H[1-6]$/.test(name)) return '标题';
  if (name === 'P') return '正文';
  if (name === 'TD' || name === 'TH') return '内容';
  if (name === 'LI') return '条目';
  if (name === 'A' || name === 'BUTTON') return '按钮';
  if (name === 'BLOCKQUOTE') return '引用';
  return '文本';
}

/**
 * Shop templates are sold for their layout, not their copy. Keep every tag,
 * style and image, replace visible text with one short placeholder per block,
 * and clear text-bearing attributes so no designer copy is carried over.
 */
export function placateTemplateText(html: string): string {
  const root = parse(html, { comment: false });
  const filled = new WeakSet<object>();
  const walk = (node: any) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeType === 3) {
        if (!String(child.text ?? '').trim()) continue;
        const block = textBlockOf(child.parentNode);
        if (filled.has(block)) {
          child.rawText = '';
          continue;
        }
        filled.add(block);
        child.rawText = placeholderFor(String(block.tagName ?? ''));
      } else if (child.nodeType === 1) {
        const tag = String(child.tagName ?? '').toLowerCase();
        if (tag === 'script' || tag === 'style') continue;
        walk(child);
      }
    }
  };
  walk(root);
  for (const node of root.querySelectorAll('*')) {
    if (node.getAttribute('alt') !== undefined) node.setAttribute('alt', '');
    if (node.getAttribute('title') !== undefined) node.setAttribute('title', '');
    if (node.getAttribute('aria-label') !== undefined) node.setAttribute('aria-label', '');
  }
  return root.toString();
}

/** Keep recorded layout when a matrix text/image slot changes. */
export function patchRecordedHtml(html: string, before: unknown, after: unknown): string {
  const replacements: [string,string][]=[];
  const walk=(a:any,b:any) => {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return;
    for (const key of Object.keys(a)) {
      if (typeof a[key] === 'string' && typeof b[key] === 'string' && a[key]!==b[key] && a[key]) {
        if (['text','src','value'].includes(key)) replacements.push([a[key],b[key]]);
      } else walk(a[key],b[key]);
    }
  };
  walk(before,after);
  for (const [a,b] of replacements) html=html.split(a).join(b);
  return sanitizeHtml(html);
}

export function rewriteHtmlAssets(html:string, resolve:(url:string)=>string|null):string {
  const root=parse(html);
  for(const node of root.querySelectorAll('img,image')) {
    const attr=node.hasAttribute('src')?'src':node.hasAttribute('xlink:href')?'xlink:href':'href';
    const raw=node.getAttribute('data-src') || node.getAttribute(attr);
    if(!raw)continue;
    const next=resolve(raw);
    if(next===null)node.remove();
    else {node.setAttribute(attr,next);node.removeAttribute('data-src');node.removeAttribute('srcset');}
  }
  for(const node of root.querySelectorAll('[style]')) {
    const style=node.getAttribute('style')!;
    node.setAttribute('style',style.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi,(_all,url)=>{const next=resolve(url);return next===null?'none':`url('${next}')`;}));
  }
  return root.toString();
}

/** Each inserted instance owns its animation IDs, including click triggers. */
export function scopeSvgIds(html:string, blockId:string):string {
  if(!html.includes('<svg'))return html;
  const root=parse(html),prefix=`k${blockId.replace(/[^a-zA-Z0-9_-]/g,'')}_`;
  const ids=new Map<string,string>();
  for(const el of root.querySelectorAll('[id]')) {const id=el.getAttribute('id')!;ids.set(id,prefix+id);el.setAttribute('id',prefix+id);}
  for(const el of root.querySelectorAll('*'))for(const attr of ['href','xlink:href','begin','end','style','fill','filter','mask','clip-path']) {
    let value=el.getAttribute(attr);if(!value)continue;
    for(const [old,next] of ids) {
      if(value===`#${old}`)value=`#${next}`;
      value=value.split(`url(#${old})`).join(`url(#${next})`);
      value=value.split(';').map(part=>part.trim().startsWith(old+'.')?part.replace(old+'.',next+'.'):part).join(';');
    }
    el.setAttribute(attr,value);
  }
  return root.toString();
}
