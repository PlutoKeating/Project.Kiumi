import { parse } from 'node-html-parser';
import { escapeHtml, type SourceFact } from './manuscript.ts';

/**
 * DOM-free DOCX paragraph extractor for servers and Agents (no Mammoth, no
 * browser APIs). It reads the document in order and produces `SourceFact`s
 * with the same formatting signals the browser importer carries. The browser
 * importer remains the richer path; anything this one cannot represent is
 * reported in `warnings` instead of being dropped silently.
 */

export interface DocxParts {
  /** word/document.xml */
  document: string;
  /** word/styles.xml */
  styles?: string;
  /** word/numbering.xml */
  numbering?: string;
  /** word/_rels/document.xml.rels */
  rels?: string;
}

export interface DocxFacts {
  facts: SourceFact[];
  /** Media paths (as in the package, e.g. `word/media/image1.png`) in order of first appearance. */
  media: string[];
  warnings: string[];
}

type Node = ReturnType<typeof parse> extends infer R ? (R extends { childNodes: Array<infer C> } ? C : never) : never;
type El = any;

const local = (el: El): string => String(el?.tagName ?? '').toLowerCase().replace(/^[a-z0-9]+:/, '');
const kids = (el: El): El[] => (el?.childNodes ?? []).filter((c: Node & { nodeType: number }) => c.nodeType === 1);
const attr = (el: El, name: string): string => {
  if (!el) return '';
  for (const key of [name, `w:${name}`]) {
    const value = el.getAttribute?.(key);
    if (value !== undefined && value !== null) return String(value);
  }
  return '';
};
const find = (el: El, name: string): El | undefined => kids(el).find(k => local(k) === name.toLowerCase());
const parseXml = (xml: string) => parse(xml, { lowerCaseTagName: false, comment: false, blockTextElements: {} } as never);

const cnDigits = '零一二三四五六七八九';
function chinese(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  if (n < 10) return cnDigits[n];
  return (n < 20 ? '' : cnDigits[Math.floor(n / 10)]) + '十' + (n % 10 ? cnDigits[n % 10] : '');
}
function letters(n: number, upper: boolean): string {
  let out = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return upper ? out : out.toLowerCase();
}
function roman(n: number, upper: boolean): string {
  if (n < 1 || n > 3999) return String(n);
  let out = '';
  for (const [v, g] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const) while (n >= v) { out += g; n -= v; }
  return upper ? out : out.toLowerCase();
}
function format(n: number, fmt: string): string {
  switch (fmt) {
    case 'upperLetter': return letters(n, true);
    case 'lowerLetter': return letters(n, false);
    case 'upperRoman': return roman(n, true);
    case 'lowerRoman': return roman(n, false);
    case 'chineseCounting': case 'chineseCountingThousand': case 'ideographTraditional': return chinese(n);
    case 'decimalZero': return String(n).padStart(2, '0');
    default: return String(n);
  }
}

export function parseDocx(parts: DocxParts): DocxFacts {
  const warnings: string[] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };

  // Relationships: id -> media path.
  const rels = new Map<string, string>();
  if (parts.rels) for (const r of kids(parseXml(parts.rels).firstChild)) {
    const target = attr(r, 'Target');
    if (target && /image/i.test(attr(r, 'Type'))) rels.set(attr(r, 'Id'), target.startsWith('/') ? target.slice(1) : `word/${target}`.replace(/word\/\.\.\//, ''));
  }

  // Styles: heading level and bold inheritance.
  const styleById = new Map<string, El>();
  if (parts.styles) for (const s of kids(parseXml(parts.styles).firstChild)) if (local(s) === 'style') styleById.set(attr(s, 'styleId'), s);
  const styleHeading = (id: string): number => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const style = styleById.get(id);
      const name = attr(find(style, 'name'), 'val') || id;
      const m = /^(?:heading|标题)\s*([1-9])$/i.exec(name) || /^Heading([1-9])$/i.exec(id);
      if (m) return Number(m[1]);
      const out = find(find(style, 'pPr'), 'outlineLvl');
      if (out && Number(attr(out, 'val')) < 9) return Number(attr(out, 'val')) + 1;
      id = attr(find(style, 'basedOn'), 'val');
    }
    return 0;
  };
  const styleNumPr = (id: string): El | undefined => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) { seen.add(id); const style = styleById.get(id); const n = find(find(style, 'pPr'), 'numPr'); if (n) return n; id = attr(find(style, 'basedOn'), 'val'); }
  };

  // Numbering definitions.
  const abstracts = new Map<string, El>();
  const nums = new Map<string, El>();
  if (parts.numbering) for (const n of kids(parseXml(parts.numbering).firstChild)) {
    if (local(n) === 'abstractNum'.toLowerCase()) abstracts.set(attr(n, 'abstractNumId'), n);
    if (local(n) === 'num') nums.set(attr(n, 'numId'), n);
  }
  const counters = new Map<string, number[]>();
  const levelDef = (numId: string, ilvl: number) => {
    const num = nums.get(numId);
    const abs = abstracts.get(attr(find(num, 'abstractNumId'), 'val'));
    const lvl = kids(abs).find(l => local(l) === 'lvl' && Number(attr(l, 'ilvl')) === ilvl);
    const override = kids(num).find(o => local(o) === 'lvloverride' && Number(attr(o, 'ilvl')) === ilvl);
    const start = Number(attr(find(find(override, 'lvl') ?? override, 'startOverride') ?? find(lvl, 'start'), 'val') || 1);
    return { lvl, start };
  };
  const label = (numId: string, ilvl: number): string => {
    const def = levelDef(numId, ilvl);
    if (!def.lvl) return '';
    const fmt = attr(find(def.lvl, 'numFmt'), 'val');
    if (fmt === 'bullet') return '•';
    const values = counters.get(numId) ?? [];
    values[ilvl] = values[ilvl] === undefined ? def.start : values[ilvl] + 1;
    for (let d = ilvl + 1; d < 9; d++) delete values[d];
    counters.set(numId, values);
    const text = attr(find(def.lvl, 'lvlText'), 'val') || `%${ilvl + 1}.`;
    return text.replace(/%([1-9])/g, (_, digit) => {
      const i = Number(digit) - 1;
      const d = levelDef(numId, i);
      return format(values[i] ?? d.start, attr(find(d.lvl, 'numFmt'), 'val'));
    });
  };

  const media: string[] = [];
  const seenMedia = new Set<string>();
  const mediaOf = (el: El): string[] => {
    const out: string[] = [];
    const visit = (n: El) => {
      for (const c of kids(n)) {
        const name = local(c);
        const id = c.getAttribute?.('r:embed') || (name === 'imagedata' ? c.getAttribute?.('r:id') : '');
        if ((name === 'blip' || name === 'imagedata') && id) {
          const path = rels.get(id);
          if (path) { out.push(path); if (!seenMedia.has(path)) { seenMedia.add(path); media.push(path); } }
          else warn('文档里有图片找不到对应文件。');
        } else visit(c);
      }
    };
    visit(el);
    return out;
  };

  const facts: SourceFact[] = [];
  const body = find(parseXml(parts.document).firstChild, 'body') ?? find(parseXml(parts.document), 'body');
  if (!body) return { facts, media, warnings: ['文档没有正文。'] };

  const runsOf = (container: El, state: { text: string[]; html: string[]; sizes: number[]; bold: boolean[]; images: string[] }) => {
    for (const child of kids(container)) {
      const name = local(child);
      if (name === 'del' || name === 'movefrom' || name === 'commentrangestart' || name === 'commentrangeend') continue;
      if (['ins', 'hyperlink', 'smarttag', 'sdt', 'sdtcontent', 'fldsimple'].includes(name)) { runsOf(child, state); continue; }
      if (name !== 'r') continue;
      const rPr = find(child, 'rPr');
      const flag = (n: string) => { const f = find(rPr, n); return !!f && !['0', 'false'].includes(attr(f, 'val')); };
      let chunk = '';
      for (const part of kids(child)) {
        const p = local(part);
        if (p === 't') chunk += part.text ?? '';
        else if (p === 'tab') chunk += ' ';
        else if (p === 'br' && attr(part, 'type') !== 'page') chunk += '\n';
        else if (p === 'drawing' || p === 'pict' || p === 'object') state.images.push(...mediaOf(part));
        else if (p === 'footnotereference' || p === 'endnotereference') warn('脚注/尾注未导入，请核对正文。');
        else if (p === 'sym') chunk += '';
      }
      if (chunk) {
        const size = Number(attr(find(rPr, 'sz'), 'val') || 0);
        if (size) state.sizes.push(size);
        state.bold.push(flag('b'));
        state.text.push(chunk);
        let html = escapeHtml(chunk).replace(/\n/g, '<br>');
        if (flag('b')) html = `<strong>${html}</strong>`;
        if (flag('i')) html = `<em>${html}</em>`;
        if (find(rPr, 'u') && attr(find(rPr, 'u'), 'val') !== 'none') html = `<u>${html}</u>`;
        if (flag('strike')) html = `<s>${html}</s>`;
        state.html.push(html);
      }
    }
  };

  const paragraph = (p: El): SourceFact => {
    const pPr = find(p, 'pPr');
    const styleId = attr(find(pPr, 'pStyle'), 'val');
    const outlineEl = find(pPr, 'outlineLvl');
    const outline = outlineEl && Number(attr(outlineEl, 'val')) < 9 ? Number(attr(outlineEl, 'val')) + 1 : styleHeading(styleId);
    const state = { text: [] as string[], html: [] as string[], sizes: [] as number[], bold: [] as boolean[], images: [] as string[] };
    runsOf(p, state);
    const numPr = find(pPr, 'numPr') ?? styleNumPr(styleId);
    let numbering: string | undefined;
    if (numPr && attr(find(numPr, 'numId'), 'val') && attr(find(numPr, 'numId'), 'val') !== '0') numbering = label(attr(find(numPr, 'numId'), 'val'), Number(attr(find(numPr, 'ilvl'), 'val') || 0)) || undefined;
    const jc = attr(find(pPr, 'jc'), 'val');
    const text = state.text.join('').replace(/\s+/g, ' ').trim();
    const size = state.sizes.length ? (Math.max(...state.sizes) / 2) * (4 / 3) : undefined;
    return {
      i: facts.length,
      kind: !text && state.images.length ? 'image' : 'text',
      text,
      html: `<p>${state.html.join('')}</p>`,
      bold: state.bold.length > 0 && state.bold.every(Boolean),
      size,
      align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left',
      outline: outline || undefined,
      numbering,
      images: state.images.length ? state.images : undefined,
    };
  };

  const table = (tbl: El): SourceFact => {
    const rows = kids(tbl).filter(r => local(r) === 'tr').map(r => kids(r).filter(c => local(c) === 'tc').map(c => {
      const text: string[] = [];
      const grab = (n: El) => { for (const k of kids(n)) { if (local(k) === 'p') { const st = { text: [] as string[], html: [] as string[], sizes: [] as number[], bold: [] as boolean[], images: [] as string[] }; runsOf(k, st); text.push(st.text.join('')); } else grab(k); } };
      grab(c);
      return text.join(' ').trim();
    }));
    const html = `<table>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    warn('表格按纯文字导入，合并单元格关系未保留。');
    return { i: facts.length, kind: 'table', text: rows.flat().join(' '), html };
  };

  const walk = (container: El) => {
    for (const child of kids(container)) {
      const name = local(child);
      if (name === 'p') {
        const fact = paragraph(child);
        if (fact.text || fact.images?.length) facts.push(fact);
        if (child.getElementsByTagName?.('w:txbxContent')?.length) warn('文本框内容未导入。');
      } else if (name === 'tbl') facts.push(table(child));
      else if (name === 'sdt' || name === 'sdtcontent') walk(child);
      else if (name === 'altchunk') warn('外部嵌入内容未导入。');
    }
  };
  walk(body);
  facts.forEach((f, i) => { f.i = i; });
  return { facts, media, warnings };
}
