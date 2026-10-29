import mammoth from 'mammoth';
import { openArchive, MAX_IMAGE, MAX_IMAGES } from './archive.ts';
import { addAsset, issue, type ImportPreview } from './model.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const all = (root: Document | Element, name: string, ns = W) => [...root.getElementsByTagNameNS(ns, name)];
const val = (el?: Element | null, name = 'val') => el?.getAttributeNS(W, name) ?? '';
const first = (root: Document | Element, name: string) => all(root, name)[0];
const wordText = (root: Element) => all(root, 't').map(el => el.textContent).join('');
function run(doc: Document, text: string) {
  const r = doc.createElementNS(W, 'w:r'), t = doc.createElementNS(W, 'w:t');
  t.setAttribute('xml:space', 'preserve'); t.textContent = text; r.append(t); return r;
}
function ordinal(n: number, format: string) {
  if (format === 'upperLetter' || format === 'lowerLetter') {
    let result = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
    return format === 'lowerLetter' ? result.toLowerCase() : result;
  }
  if (/^(upper|lower)Roman$/.test(format)) {
    if (n > 3999 || n < 1) return String(n);
    let result = '';
    for (const [value, glyph] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']] as const) while (n >= value) { result += glyph; n -= value; }
    return format === 'lowerRoman' ? result.toLowerCase() : result;
  }
  if (format === 'decimalZero') return String(n).padStart(2, '0');
  if (['chineseCounting','chineseCountingThousand','ideographTraditional'].includes(format) && n > 0 && n < 100) {
    const digits = '零一二三四五六七八九';
    return n < 10 ? digits[n] : (n < 20 ? '' : digits[Math.floor(n / 10)]) + '十' + (n % 10 ? digits[n % 10] : '');
  }
  return String(n);
}

/** Mammoth handles OOXML structure. This adapter makes lossy features explicit before conversion. */
export async function readDocx(file: File, preview: ImportPreview, requireTeam: () => void): Promise<string> {
  const archive = await openArchive(file);
  if (!archive.zip.file('word/document.xml')) throw new Error('这不是有效的 Word DOCX 文件，请用 Word/WPS 另存为 .docx。');
  const media = archive.entries.filter(e => /^word\/media\//.test(e.name));
  if (media.length) requireTeam();
  let imageBytes = 0;
  for (const entry of media) { imageBytes += (await archive.read(entry.name, MAX_IMAGES)).length; if (imageBytes > MAX_IMAGES) throw new Error('图片总量超过 80 MB，请拆分稿件。'); }
  const styles = archive.zip.file('word/styles.xml') ? await archive.xml('word/styles.xml') : null;
  const styleById = new Map(styles ? all(styles, 'style').map(s => [val(s, 'styleId'), s]) : []);
  function inherited(styleId: string, name: string): Element | undefined {
    const seen = new Set<string>();
    while (styleId && !seen.has(styleId)) {
      seen.add(styleId); const style = styleById.get(styleId); if (!style) break;
      const found = first(style, name); if (found) return found;
      styleId = val(first(style, 'basedOn'));
    }
  }
  const numbering = archive.zip.file('word/numbering.xml') ? await archive.xml('word/numbering.xml') : null;
  const nums = new Map(numbering ? all(numbering, 'num').map(n => [val(n, 'numId'), n]) : []);
  const abstracts = new Map(numbering ? all(numbering, 'abstractNum').map(n => [val(n, 'abstractNumId'), n]) : []);
  const counts = new Map<string, number[]>();
  const styleMap = ['u => u', 'strike => s', "p[style-name='Title'] => h1:fresh", "p[style-name='标题'] => h1:fresh"];
  for (let i = 0; i < 9; i++) {
    styleMap.push(`p.KiumiHeading${i + 1} => h${Math.min(i + 1, 6)}:fresh`);
    styleMap.push(`p.KiumiList${i} => p.ki-list-${i}:fresh`);
  }
  const document = await archive.xml('word/document.xml');
  if (document.getElementsByTagNameNS('*', 'blip').length || document.getElementsByTagNameNS('*', 'imagedata').length) requireTeam();
  const parts = ['word/document.xml', ...archive.entries.filter(e => /^word\/(footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(e.name)).map(e => e.name)];
  const extra: string[] = [];
  for (const path of parts) {
    const xml = path === 'word/document.xml' ? document : await archive.xml(path);
    for (const alternate of [...xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'AlternateContent')]) {
      const branches = [...alternate.children];
      const fallback = branches.find(e => e.localName === 'Fallback');
      const chosen = fallback?.children.length ? fallback : branches.find(e => e.localName === 'Choice');
      if (chosen) {
        issue(preview.issues, path, '兼容图形采用文档提供的兼容内容（可能是静态图片），请核对图形和位置。');
        alternate.replaceWith(...chosen.childNodes);
      } else {
        const p = xml.createElementNS(W, 'w:p'); p.append(run(xml, '〔兼容图形待补充〕')); alternate.replaceWith(p);
        issue(preview.issues, path, '兼容图形没有可读取内容，已放置待补充标记。');
      }
    }
    const revisions = all(xml, 'ins').length + all(xml, 'del').length + all(xml, 'moveFrom').length + all(xml, 'moveTo').length;
    if (revisions) issue(preview.issues, path, '已按接受修订后的最终稿导入，删除内容不进入正文。');
    // Keep deleted paragraph markers for Mammoth's paragraph-merge handling.
    for (const el of [...all(xml, 'del'), ...all(xml, 'moveFrom')]) if (el.parentElement?.localName !== 'rPr') el.remove();
    for (const el of [...all(xml, 'ins'), ...all(xml, 'moveTo')]) el.replaceWith(...el.childNodes);
    const paras = all(xml, 'p');
    for (let index = 0; index < paras.length; index++) {
      const p = paras[index], location = `${path.replace('word/', '')} · 第 ${index + 1} 段`;
      let pr = [...p.children].find(e => e.localName === 'pPr');
      if (!pr) { pr = xml.createElementNS(W, 'w:pPr'); p.prepend(pr); }
      let style = first(pr, 'pStyle');
      const styleId = val(style);
      const styleName = val(styleById.get(styleId) ? first(styleById.get(styleId)!, 'name') : null);
      const outline = first(pr, 'outlineLvl') ?? inherited(styleId, 'outlineLvl');
      const match = /^(?:heading|标题)\s*([1-9])$/i.exec(styleName || styleId);
      const heading = outline && Number(val(outline)) < 9 ? Number(val(outline)) + 1 : match ? Number(match[1]) : 0;
      function setStyle(id: string) {
        if (!style) { style = xml.createElementNS(W, 'w:pStyle'); pr!.prepend(style); }
        style.setAttributeNS(W, 'w:val', id);
      }
      if (heading) { setStyle(`KiumiHeading${heading}`); if (heading > 6) issue(preview.issues, location, `原 ${heading} 级标题按六级标题显示，可在预览调整。`); }
      const numPr = first(pr, 'numPr') ?? inherited(styleId, 'numPr');
      if (numPr && val(first(numPr, 'numId')) !== '0') {
        const numId = val(first(numPr, 'numId')), level = Number(val(first(numPr, 'ilvl')) || 0);
        const num = nums.get(numId), abstract = num && abstracts.get(val(first(num, 'abstractNumId')));
        const levels = abstract ? all(abstract, 'lvl') : [];
        const definition = (i: number) => {
          const override = num && all(num, 'lvlOverride').find(e => Number(val(e, 'ilvl')) === i);
          const lvl = (override && first(override, 'lvl')) ?? levels.find(e => Number(val(e, 'ilvl')) === i);
          return { lvl, start: Number(val(override && first(override, 'startOverride')) || val(lvl && first(lvl, 'start')) || 1) };
        };
        const def = definition(level);
        if (def.lvl && level >= 0 && level < 9) {
          const key = `${path}:${numId}`, values = counts.get(key) ?? [];
          values[level] = values[level] === undefined ? def.start : values[level] + 1;
          // Respect explicit no-restart/custom-restart levels; otherwise restart descendants.
          for (let deeper = level + 1; deeper < 9; deeper++) {
            const d = definition(deeper), restart = d.lvl && first(d.lvl, 'lvlRestart');
            if (!restart || Number(val(restart)) === level + 1) delete values[deeper];
          }
          counts.set(key, values);
          const format = val(first(def.lvl, 'numFmt'));
          const label = format === 'bullet' ? '•' : (val(first(def.lvl, 'lvlText')) || `%${level + 1}.`).replace(/%([1-9])/g, (_, digit) => {
            const i = Number(digit) - 1, d = definition(i);
            const f = d.lvl ? val(first(d.lvl, 'numFmt')) : 'decimal';
            if (!['decimal','decimalZero','upperLetter','lowerLetter','upperRoman','lowerRoman','chineseCounting','chineseCountingThousand','ideographTraditional'].includes(f)) issue(preview.issues, location, `编号格式 ${f} 暂按数字显示，请核对。`);
            const value = values[i] ?? d.start;
            if (['chineseCounting','chineseCountingThousand','ideographTraditional'].includes(f) && value >= 100) issue(preview.issues, location, '百位以上中文编号暂按数字显示，请核对。');
            return ordinal(value, f);
          });
          pr.after(run(xml, label + ' '));
          if (!heading) setStyle(`KiumiList${level}`);
          for (const node of all(pr, 'numPr')) node.remove();
        } else issue(preview.issues, location, '无法完整解析此段自动编号，请在预览核对。');
      }
      for (const anchor of [...p.getElementsByTagNameNS('*', 'anchor')]) if (anchor.namespaceURI?.includes('wordprocessingDrawing')) issue(preview.issues, location, '浮动图片按文档锚点落位，文字环绕未保留。');
      if (all(p, 'txbxContent').length) issue(preview.issues, location, '文本框内容按锚点附近的正文显示，不保留浮动布局。');
      // Preserve formulas as explicit linear text rather than silently dropping OMML.
      for (const math of all(p, 'oMath', M)) {
        const text = [...math.getElementsByTagNameNS(M, 't')].map(e => e.textContent).join(' ');
        math.replaceWith(run(xml, `〔公式待核对：${text || '无法提取，请补充公式图片'}〕`));
        issue(preview.issues, location, '公式降级为原位置的线性文字，分式/上下标等结构未保留；可取消并准备公式图片。');
      }
      for (const container of all(p, 'oMathPara', M)) container.replaceWith(...container.childNodes);
      for (const node of [...p.getElementsByTagNameNS('*', 'chart'), ...p.getElementsByTagNameNS('*', 'relIds'), ...all(p, 'object'), ...all(p, 'altChunk')]) {
        if (!p.contains(node)) continue;
        if (node.localName === 'object' && node.getElementsByTagNameNS('*', 'imagedata').length) {
          node.replaceWith(...node.childNodes);
          issue(preview.issues, location, '嵌入对象使用文档提供的静态预览图片，不能编辑原对象。');
          continue;
        }
        const kind = node.localName === 'chart' ? '图表' : node.localName === 'relIds' ? 'SmartArt' : '嵌入对象';
        let target = node;
        while (target.parentElement && target.parentElement !== p && target.parentElement.localName !== 'r') target = target.parentElement;
        target.replaceWith(run(xml, `〔${kind}待补充：请插入原稿截图或图片〕`));
        issue(preview.issues, location, `${kind}无法可靠转换，已保留位置标记。确认导入将保留标记，可随后替换为图片。`);
      }
      for (const drawing of [...all(p, 'drawing'), ...all(p, 'pict')]) {
        if (!p.contains(drawing) || drawing.getElementsByTagNameNS('*', 'blip').length || drawing.getElementsByTagNameNS('*', 'imagedata').length || all(drawing, 'txbxContent').length) continue;
        const text = [...drawing.getElementsByTagNameNS('*', 't')].map(el => el.textContent).join(' ');
        drawing.replaceWith(run(xml, `〔图形待核对：${text || '请补充原稿图片'}〕`));
        issue(preview.issues, location, '图形未提供可用的预览图片，已保留文字或待补充标记。');
      }
      if ([...p.getElementsByTagNameNS('*', 'instrText')].some(n => /\bTOC\b/.test(n.textContent || ''))) issue(preview.issues, location, '目录保留已存储的文字，不自动更新页码；请删除不适用于公众号的页码。');
    }
    // Block-level embedded content also needs a visible marker.
    for (const node of all(xml, 'altChunk')) {
      const p = xml.createElementNS(W, 'w:p'); p.append(run(xml, '〔外部嵌入内容待补充〕')); node.replaceWith(p);
      issue(preview.issues, path, '外部嵌入内容不加载，已放置待补充标记。');
    }
    if (/\/(header|footer)\d+\.xml$/.test(path)) {
      const label = path.includes('/header') ? '页眉' : '页脚';
      issue(preview.issues, path, `${label}提取为正文末尾的独立内容，不重复分页。`);
      const html = all(xml, 'p').map(p => wordText(p)).filter(Boolean);
      const escaped = (s: string) => { const el = window.document.createElement('span'); el.textContent = s; return el.innerHTML; };
      extra.push(`<h3>${label}</h3>${html.map(t => `<p>${escaped(t)}</p>`).join('')}`);
      if (xml.getElementsByTagNameNS(R, '*').length || xml.getElementsByTagNameNS('*', 'blip').length || all(xml, 'tbl').length) {
        extra.push(`<p>〔${label}中的图片或表格待补充〕</p>`);
        issue(preview.issues, path, `${label}仅提取文字，图片/表格请另行补充。`);
      }
    }
    archive.zip.file(path, new XMLSerializer().serializeToString(xml));
  }
  if (archive.zip.file('word/comments.xml')) issue(preview.issues, '批注', '批注不进入正文，请在原稿中查阅。');
  // Read and replace every ZIP member through the bounded reader before Mammoth expands it.
  for (const entry of archive.entries) if (!parts.includes(entry.name)) archive.zip.file(entry.name, await archive.read(entry.name, /^word\/media\//.test(entry.name) ? MAX_IMAGES : undefined));
  const mappedStyles = styles ?? new DOMParser().parseFromString(`<w:styles xmlns:w="${W}"/>`, 'application/xml');
  for (let i = 0; i < 9; i++) for (const id of [`KiumiHeading${i + 1}`, `KiumiList${i}`]) {
    if (all(mappedStyles, 'style').some(s => val(s, 'styleId') === id)) continue;
    const style = mappedStyles.createElementNS(W, 'w:style');
    style.setAttributeNS(W, 'w:type', 'paragraph'); style.setAttributeNS(W, 'w:styleId', id);
    const name = mappedStyles.createElementNS(W, 'w:name'); name.setAttributeNS(W, 'w:val', id); style.append(name); mappedStyles.documentElement.append(style);
  }
  archive.zip.file('word/styles.xml', new XMLSerializer().serializeToString(mappedStyles));
  let imageIndex = 0;
  const result = await mammoth.convertToHtml({ arrayBuffer: await archive.zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }) }, {
    includeEmbeddedStyleMap: false, externalFileAccess: false, ignoreEmptyParagraphs: false,
    idPrefix: `word-${crypto.randomUUID()}-`, styleMap,
    convertImage: mammoth.images.imgElement(async image => {
      requireTeam(); imageIndex++;
      try {
        const bytes = new Uint8Array(await image.readAsArrayBuffer());
        if (bytes.length > MAX_IMAGE) throw new Error('单张图片超过 10 MB，请压缩后重新插入。');
        return { src: (await addAsset(preview, bytes, `word-image-${imageIndex}.${image.contentType.split('/')[1] || 'png'}`)).url };
      } catch (error) {
        issue(preview.issues, `图片 ${imageIndex}`, (error as Error).message);
        return { src: '', alt: `图片 ${imageIndex} 读取失败，请重新插入` };
      }
    }),
  });
  for (const message of result.messages) issue(preview.issues, 'Word 转换检查', message.message);
  return result.value + extra.join('');
}
