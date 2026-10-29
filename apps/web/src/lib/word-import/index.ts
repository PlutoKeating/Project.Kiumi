import DOMPurify from 'dompurify';
import { marked } from 'marked';
import * as api from '../../api.ts';
import { cleanHtml, importHtml } from '../import.ts';
import { openArchive, MAX_IMAGE, MAX_IMAGES } from './archive.ts';
import { addAsset, issue, releasePreview, type ImportPreview, type ImportItem } from './model.ts';
export type { ImportPreview } from './model.ts';
export { releasePreview } from './model.ts';

export function requireImageTeam() {
  if (!api.teamId()) throw new Error('带图导入前请先登录并选择团队，再重新导入。');
}
const allowedTags = ['p','h1','h2','h3','h4','h5','h6','div','section','article','span','strong','b','em','i','u','s','del','ins','sup','sub','br','hr','a','img','table','thead','tbody','tfoot','tr','th','td','caption','colgroup','col','ul','ol','li','blockquote','pre','code','figure','figcaption'];
const safe = (html: string) => DOMPurify.sanitize(html, { ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: ['href','src','alt','title','colspan','rowspan','start','value','id','class','style'], ALLOW_DATA_ATTR: false, ADD_URI_SAFE_ATTR: ['colspan','rowspan','start','value'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|blob|file|cid):|#|\/)/i });
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const previewModel = (title: string): ImportPreview => ({ title, items: [], assets: [], issues: [] });
const escape = (text: string) => { const el = document.createElement('span'); el.textContent = text; return el.innerHTML; };

function classify(el: Element) {
  if (/^H[1-6]$/.test(el.tagName)) return `${el.tagName.slice(1)} 级标题`;
  if (el.matches('table') || el.querySelector('table')) return '表格';
  if (el.matches('ul,ol')) return '列表';
  if (el.matches('img') || (!el.textContent?.trim() && el.querySelector('img'))) return '图片';
  if (el.matches('blockquote')) return '引用';
  return '段落';
}

/** Only semantic structure enters the canvas; Office page CSS never leaks into it. */
function normalize(html: string, preview: ImportPreview) {
  const raw = parse(html);
  const office = /mso-|class=["']Mso|schemas-microsoft-com|wps/i.test(html);
  if (office) {
    if (raw.querySelector('del,ins')) issue(preview.issues, '粘贴修订', '删除的修订内容已移除，插入内容已接受。');
    for (const el of raw.querySelectorAll('del')) el.remove();
    for (const el of raw.querySelectorAll('ins')) el.replaceWith(...el.childNodes);
    for (const el of raw.querySelectorAll('[style]')) if (/mso-element\s*:\s*comment/i.test(el.getAttribute('style') || '')) {
      el.remove(); issue(preview.issues, '粘贴批注', '批注不进入正文。');
    }
  }
  for (const el of raw.querySelectorAll('math,svg')) {
    const marker = raw.createElement('span'); marker.textContent = `〔公式/图形待核对：${el.textContent?.trim().slice(0, 300) || '请补充原稿图片'}〕`;
    el.replaceWith(marker); issue(preview.issues, '粘贴公式/图形', '无法从剪贴板可靠还原结构，已在原位置放置待核对标记；请使用 DOCX 或补充图片。');
  }
  const classStyles = new Map<string, string>();
  for (const sheet of raw.querySelectorAll('style')) {
    for (const match of (sheet.textContent || '').matchAll(/(?:p|span)?\.([\w-]+)\s*\{([^}]+)\}/g)) classStyles.set(match[1], match[2]);
  }
  for (const el of raw.querySelectorAll<HTMLElement>('p,span')) {
    const combined = [...el.classList].map(c => classStyles.get(c) || '').join(';') + ';' + (el.getAttribute('style') || '');
    el.setAttribute('style', combined);
  }
  for (const node of raw.querySelectorAll('script,style,iframe,object,embed')) {
    if (node.matches('object,embed')) {
      const replacement = raw.createElement('p'); replacement.textContent = '〔粘贴的嵌入对象待补充〕'; node.replaceWith(replacement);
      issue(preview.issues, '粘贴内容', '嵌入对象无法读取，请改用 DOCX 导入或补充图片。');
    } else node.remove();
  }
  // VML images often carry inaccessible local file paths. Keep a visible missing-image slot.
  for (const el of [...raw.getElementsByTagName('*')]) if (el.localName.endsWith(':imagedata')) {
    const img = raw.createElement('img'); img.src = el.getAttribute('src') || ''; el.replaceWith(img);
  }
  const root = parse(safe(raw.body.innerHTML)).body;
  let officeList = 0, previousOffice = false;
  for (const p of root.querySelectorAll<HTMLElement>('p')) {
    const style = p.getAttribute('style') || '';
    const outline = /mso-outline-level\s*:\s*([1-9])/i.exec(style);
    if (outline) {
      const heading = document.createElement(`h${Math.min(Number(outline[1]), 6)}`); heading.innerHTML = p.innerHTML; p.replaceWith(heading); continue;
    }
    const list = /mso-list\s*:\s*l(\d+)\s+level(\d+)\s+lfo(\d+)/i.exec(style);
    if (list) {
      p.classList.add(`ki-list-${Math.min(8, Number(list[2]) - 1)}`);
      const key = Number(list[3]); if (!previousOffice || officeList !== key) p.dataset.listBreak = 'true';
      officeList = key; previousOffice = true;
      issue(preview.issues, '粘贴列表', '已保留剪贴板中的列表编号与层级；如编号缺失，请使用 DOCX 文件导入。');
    } else previousOffice = false;
    const size = /font-size\s*:\s*(\d+(?:\.\d+)?)(pt|px)/i.exec(style);
    const large = size && Number(size[1]) * (size[2].toLowerCase() === 'pt' ? 4 / 3 : 1) >= 18;
    const bold = /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || (!!p.querySelector('b,strong') && p.textContent?.trim() === p.querySelector('b,strong')?.textContent?.trim());
    if (!list && (large || bold) && (p.textContent?.trim().length || 0) < 100) p.dataset.candidate = 'true';
  }
  // Keep text emphasis, remove source fonts/layout, then apply compact inline article styles.
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const style = el.getAttribute('style') || '';
    const marks = [ [/font-weight\s*:\s*(bold|[6-9]00)/i, 'strong'], [/font-style\s*:\s*italic/i, 'em'], [/text-decoration[^;]*underline/i, 'u'], [/text-decoration[^;]*line-through/i, 's'] ] as const;
    if (el.tagName === 'SPAN') for (const [pattern, tag] of marks) if (pattern.test(style)) {
      const wrapper = document.createElement(tag); wrapper.append(...el.childNodes); el.append(wrapper);
    }
    el.removeAttribute('style');
    if (el.matches('p')) el.style.cssText = 'margin:0 0 16px;line-height:1.75;overflow-wrap:anywhere';
    if (el.matches('h1,h2,h3,h4,h5,h6')) el.style.cssText = `margin:20px 0 12px;font-weight:700;font-size:${[28,24,21,19,18,17][Number(el.tagName[1])-1]}px;line-height:1.5`;
    if (el.matches('img')) el.style.cssText = 'max-width:100%;height:auto';
    if (el.matches('table')) {
      el.style.cssText = 'width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0';
      if ([...el.querySelectorAll('tr')].some(row => [...row.children].reduce((n, cell) => n + Number(cell.getAttribute('colspan') || 1), 0) > 6)) issue(preview.issues, '表格', '表格列数较多，已自适应换行，请检查公众号宽度下的可读性。');
    }
    if (el.matches('td,th')) el.style.cssText = 'border:1px solid #d1d5db;padding:8px;overflow-wrap:anywhere;vertical-align:top';
    if (el.matches('ul,ol')) el.style.cssText = 'padding-left:24px;margin:0 0 16px';
    if (el.matches('blockquote')) el.style.cssText = 'margin:12px 0;padding-left:12px;border-left:3px solid #d1d5db';
    if (el.matches('a')) {
      const href = el.getAttribute('href') || '';
      if (!/^(https?:|mailto:|#)/i.test(href)) el.removeAttribute('href');
    }
  }
  const elements: Element[] = [];
  function visit(parent: Element) {
    let inline: Node[] = [];
    const flush = () => { if (inline.some(n => n.textContent?.trim() || n instanceof Element)) { const p = document.createElement('p'); p.append(...inline); elements.push(p); } inline = []; };
    for (const node of [...parent.childNodes]) {
      if (node instanceof Element && node.matches('div,section,article')) { flush(); visit(node); }
      else if (node instanceof Element && node.matches('p,h1,h2,h3,h4,h5,h6,table,ul,ol,blockquote,pre,figure,hr')) { flush(); elements.push(node); }
      else if (node.nodeType === Node.TEXT_NODE || node instanceof Element) inline.push(node);
    }
    flush();
  }
  visit(root);
  let listRoot: HTMLElement | null = null;
  let stack: { list: HTMLElement; last?: HTMLElement }[] = [];
  const grouped: Element[] = [];
  for (const el of elements) {
    const match = /(?:^|\s)ki-list-(\d)(?:\s|$)/.exec(el.className);
    if (!match) { listRoot = null; stack = []; grouped.push(el); continue; }
    const level = Number(match[1]);
    if (!listRoot || (el as HTMLElement).dataset.listBreak) {
      listRoot = document.createElement('ul'); listRoot.style.cssText = 'list-style:none;padding-left:0;margin:0 0 16px';
      grouped.push(listRoot); stack = [{ list: listRoot }];
    }
    while (stack.length <= level) {
      const parent = stack.at(-1)!;
      if (!parent.last) { parent.last = document.createElement('li'); parent.list.append(parent.last); }
      const nested = document.createElement('ul'); nested.style.cssText = 'list-style:none;padding-left:24px'; parent.last.append(nested); stack.push({ list: nested });
    }
    stack = stack.slice(0, level + 1);
    const li = document.createElement('li'); li.innerHTML = el.innerHTML; li.style.lineHeight = '1.75'; stack[level].list.append(li); stack[level].last = li;
  }
  const split = grouped.flatMap(el => {
    const images = [...el.querySelectorAll('img')];
    if (el.matches('p') && !el.textContent?.trim() && images.length > 1) return images.map(img => { const p = document.createElement('p'); p.append(img); return p; });
    return [el];
  });
  preview.items = split.map<ImportItem>((el, index) => {
    const candidate = el instanceof HTMLElement && el.dataset.candidate === 'true';
    if (candidate) issue(preview.issues, `块 ${index + 1}`, '疑似标题，请选择正文或标题层级。');
    for (const node of [el, ...el.querySelectorAll('*')]) { node.removeAttribute('class'); node.removeAttribute('data-candidate'); node.removeAttribute('data-list-break'); }
    const label = classify(el);
    return { label, candidate, block: { kind: 'library', id: crypto.randomUUID(), tplId: `imported:${label}`, matrix: [], html: safe(el.outerHTML) } };
  }).filter(item => item.block.html?.trim());
  // De-duplicate identical notices without losing distinct source locations.
  preview.issues = preview.issues.filter((entry, i, entries) => entries.findIndex(e => e.location === entry.location && e.message === entry.message) === i);
}

async function collectImages(preview: ImportPreview, clipboard: File[] = [], baseUrl?: string) {
  const docs = preview.items.map(item => parse(item.block.html || ''));
  const images = docs.flatMap((doc, index) => [...doc.querySelectorAll('img')].map(image => ({ image, index })));
  if (!images.length && !clipboard.length) return;
  requireImageTeam();
  const known = new Set(preview.assets.map(a => a.url));
  const local = images.filter(({ image }) => /^(file:|cid:)/i.test(image.getAttribute('src') || ''));
  const clipboardMap = new Map<Element, File>();
  if (local.length === 1 && clipboard.length === 1) clipboardMap.set(local[0].image, clipboard[0]);
  else if (local.length && clipboard.length) issue(preview.issues, '剪贴板图片', '多张本地图片无法可靠匹配位置，请改用 DOCX 导入。');
  const resolved = new Map<string, string>();
  for (const { image, index } of images) {
    const source = image.getAttribute('src') || '';
    if (known.has(source)) continue;
    if (resolved.has(source)) { image.src = resolved.get(source)!; continue; }
    try {
      let file = clipboardMap.get(image);
      if (!file) {
        let url = source;
        if (baseUrl) url = new URL(source, baseUrl).href;
        if (!/^(https?:|data:image\/(png|jpeg|gif|webp);base64,)/i.test(url)) throw new Error('剪贴板未提供图片数据，请使用 DOCX 导入或重新插入图片。');
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok || !response.body) throw new Error('图片无法下载，请使用 DOCX 导入或重新插入。');
        const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
        try {
          while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_IMAGE) throw new Error('单张图片超过 10 MB。'); chunks.push(value); }
        } finally { await reader.cancel(); }
        file = new File(chunks.map(c => new Uint8Array(c)), `import-${index + 1}.png`);
      }
      if (file.size > MAX_IMAGE) throw new Error('单张图片超过 10 MB。');
      if (preview.assets.reduce((n, a) => n + a.file.size, 0) + file.size > MAX_IMAGES) throw new Error('图片总量超过 80 MB。');
      const asset = await addAsset(preview, new Uint8Array(await file.arrayBuffer()), file.name);
      image.src = asset.url; resolved.set(source, asset.url);
    } catch (error) {
      const p = document.createElement('span'); p.textContent = `〔图片待补充：${image.alt || `块 ${index + 1}`}〕`; image.replaceWith(p);
      issue(preview.issues, `块 ${index + 1} · 图片`, (error as Error).message);
    }
  }
  docs.forEach((doc, i) => { preview.items[i].block.html = preview.preserveLayout ? cleanHtml(doc.body.innerHTML) : safe(doc.body.innerHTML); });
  if (!images.length) for (const file of clipboard) {
    if (file.size > MAX_IMAGE) throw new Error('单张图片超过 10 MB。');
    if (preview.assets.reduce((n, a) => n + a.file.size, 0) + file.size > MAX_IMAGES) throw new Error('图片总量超过 80 MB。');
    const asset = await addAsset(preview, new Uint8Array(await file.arrayBuffer()), file.name);
    preview.items.push({ label: '图片', block: { kind: 'library', id: crypto.randomUUID(), tplId: 'imported:图片', matrix: [], html: `<p><img src="${asset.url}" style="max-width:100%;height:auto"></p>` } });
    if (preview.items.length > 1) issue(preview.issues, `块 ${preview.items.length}`, '剪贴板未提供图片位置，图片已追加在末尾，请核对。');
  }
}

export async function prepareText(source: string, kind: 'html' | 'markdown' | 'text', clipboard: File[] = [], baseUrl?: string): Promise<ImportPreview> {
  const preview = previewModel('导入文稿');
  try {
    if (source.length > 20 * 1024 * 1024) throw new Error('文本内容过大，请拆分后导入。');
    if (/^PK[\x03\x05\x07]|\x00/.test(source)) throw new Error('检测到二进制内容，请使用文件导入选择 .docx。');
    let html = kind === 'markdown' ? await marked.parse(source, { gfm: true, breaks: true }) : kind === 'text' ? source.split(/\r?\n/).map(line => `<p>${escape(line) || '<br>'}</p>`).join('') : source;
    if (baseUrl) { const doc = parse(html); for (const a of doc.querySelectorAll('a[href]')) try { a.setAttribute('href', new URL(a.getAttribute('href')!, baseUrl).href); } catch {} html = doc.body.innerHTML; }
    normalize(html, preview); await collectImages(preview, clipboard, baseUrl); return preview;
  } catch (error) { releasePreview(preview); throw error; }
}

/** Keep existing HTML/webpage layout and SVG import behavior separate from Office normalization. */
export async function prepareRichHtml(source: string, baseUrl?: string): Promise<ImportPreview> {
  const preview = previewModel('导入网页'); preview.preserveLayout = true;
  try {
    if (source.length > 20 * 1024 * 1024 || /^PK[\x03\x05\x07]|\x00/.test(source)) throw new Error('HTML 文件过大或包含二进制内容，请核对文件格式。');
    if (parse(source).querySelector('img,image')) requireImageTeam();
    const blocks = await importHtml(source, baseUrl);
    preview.items = blocks.filter((b): b is api.LibraryBlock => b.kind === 'library').map(block => ({ block, label: 'HTML 布局' }));
    await collectImages(preview, [], baseUrl); return preview;
  } catch (error) { releasePreview(preview); throw error; }
}

export async function prepareFile(file: File): Promise<ImportPreview> {
  const preview = previewModel(file.name.replace(/\.[^.]+$/, ''));
  try {
    if (/\.(doc|wps|rtf)$/i.test(file.name)) throw new Error('请先在 Word/WPS 中另存为 .docx，旧版 DOC、WPS、RTF 不能按文本导入。');
    if (/\.docx$/i.test(file.name)) {
      const { readDocx } = await import('./docx.ts');
      const html = await readDocx(file, preview, requireImageTeam);
      normalize(html, preview); await collectImages(preview); return preview;
    }
    if (/\.zip$/i.test(file.name)) {
      requireImageTeam(); preview.galleryOnly = true;
      const archive = await openArchive(file); let total = 0;
      for (const entry of archive.entries) {
        if (entry.name.startsWith('__MACOSX/') || entry.name.split('/').at(-1)?.startsWith('.')) continue;
        if (!/\.(png|jpe?g|gif|webp)$/i.test(entry.name)) { issue(preview.issues, entry.name, '不是支持的图片文件，已跳过。'); continue; }
        const bytes = await archive.read(entry.name, MAX_IMAGES); total += bytes.length;
        if (total > MAX_IMAGES) throw new Error('图片总量超过 80 MB，请拆分压缩包。');
        if (bytes.length > MAX_IMAGE) { issue(preview.issues, entry.name, '单张超过 10 MB，已跳过，请压缩后上传。'); continue; }
        try { await addAsset(preview, bytes, entry.name.split('/').at(-1)!); }
        catch (error) { issue(preview.issues, entry.name, (error as Error).message); }
      }
      if (!preview.assets.length) throw new Error('ZIP 内没有可导入的图片。');
      return preview;
    }
    if (!/\.(md|markdown|html?|txt)$/i.test(file.name)) throw new Error('不支持此文件类型，请选择 DOCX、图片 ZIP、HTML、Markdown 或 TXT。');
    if (file.size > 20 * 1024 * 1024) throw new Error('文本文件超过 20 MB，请拆分后导入。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    let source: string;
    try { source = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error('文本编码无法识别，请另存为 UTF-8 后导入；Word 请使用 .docx。'); }
    const result = /\.html?$/i.test(file.name) ? await prepareRichHtml(source) : await prepareText(source, /\.txt$/i.test(file.name) ? 'text' : 'markdown');
    result.title = preview.title; return result;
  } catch (error) { releasePreview(preview); throw error; }
}

export function setHeading(item: ImportItem, level: number): ImportItem {
  const root = parse(item.block.html || '').body;
  const old = root.firstElementChild;
  if (!old || !old.matches('p,h1,h2,h3,h4,h5,h6')) return item;
  const el = document.createElement(level ? `h${level}` : 'p'); el.innerHTML = old.innerHTML;
  el.style.cssText = level ? `margin:20px 0 12px;font-weight:700;font-size:${[28,24,21,19,18,17][level-1]}px;line-height:1.5` : 'margin:0 0 16px;line-height:1.75';
  old.replaceWith(el); const label = level ? `${level} 级标题` : '段落';
  return { ...item, candidate: false, label, block: { ...item.block, tplId: `imported:${label}`, html: safe(root.innerHTML) } };
}

export async function uploadPreview(preview: ImportPreview, scope: string, progress: (text: string) => void, signal?: AbortSignal) {
  const check = () => { if (signal?.aborted) throw new Error('已取消导入；已上传的图片保留在团队图库。'); if (api.workspaceKey() !== scope) throw new Error('团队或账号已切换，请重新导入。'); };
  check(); if (preview.assets.length) requireImageTeam();
  for (let i = 0; i < preview.assets.length; i++) {
    check(); const asset = preview.assets[i]; progress(`上传图片 ${i + 1}/${preview.assets.length}`);
    try { if (!asset.uploadedUrl) asset.uploadedUrl = (await api.uploadImage(asset.file, signal)).url; }
    catch (error) { check(); throw error; }
    check();
  }
  return preview.items.map(item => {
    const root = parse(item.block.html || '');
    for (const img of root.querySelectorAll('img')) {
      const asset = preview.assets.find(a => a.url === img.getAttribute('src'));
      if (asset) img.setAttribute('src', asset.uploadedUrl!);
    }
    return { ...item.block, html: preview.preserveLayout ? cleanHtml(root.body.innerHTML) : safe(root.body.innerHTML) };
  });
}
