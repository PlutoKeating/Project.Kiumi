import { parse } from 'node-html-parser';

/**
 * Team typesetting rules (the written house style) as data.
 * Applying them while filling a template and linting a finished article use
 * the same object, so the web panel and MCP agree.
 */
export interface TypesetRules {
  bodySize: number;
  headingSize: number;
  headingBold: boolean;
  /** Text colour for everything except the article title. */
  textColor: string;
  lineHeight: number;
  letterSpacing: number;
  paragraphGap: number;
  /** Left/right padding in px. */
  sidePadding: number;
  firstLineIndent: boolean;
  /** Image width as a CSS percentage. */
  imageWidth: number;
  /** One blank line between text and image, and between two images. */
  blankAroundImages: boolean;
  /** Blank line before the first and after the last block of the article body. */
  blankAtEdges: boolean;
  /** Long titles: keep the part before the first colon or vertical bar. */
  titleCutAtDelimiter: boolean;
  /** Long titles: turn commas into a space. */
  titleCommaToSpace: boolean;
}

export const DEFAULT_RULES: TypesetRules = {
  bodySize: 14,
  headingSize: 16,
  headingBold: true,
  textColor: '#000000',
  lineHeight: 2,
  letterSpacing: 2,
  paragraphGap: 0,
  sidePadding: 20,
  firstLineIndent: true,
  imageWidth: 90,
  blankAroundImages: true,
  blankAtEdges: true,
  titleCutAtDelimiter: true,
  titleCommaToSpace: true,
};

export function normalizeRules(input: Partial<TypesetRules> | null | undefined): TypesetRules {
  const out = { ...DEFAULT_RULES };
  if (!input || typeof input !== 'object') return out;
  const num = (k: keyof TypesetRules, min: number, max: number) => {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) (out as Record<string, unknown>)[k] = v;
  };
  const bool = (k: keyof TypesetRules) => {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === 'boolean') (out as Record<string, unknown>)[k] = v;
  };
  num('bodySize', 10, 30); num('headingSize', 10, 40); num('lineHeight', 1, 4); num('letterSpacing', 0, 10);
  num('paragraphGap', 0, 60); num('sidePadding', 0, 60); num('imageWidth', 30, 100);
  for (const k of ['headingBold', 'firstLineIndent', 'blankAroundImages', 'blankAtEdges', 'titleCutAtDelimiter', 'titleCommaToSpace'] as const) bool(k);
  if (typeof input.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(input.textColor)) out.textColor = input.textColor.toLowerCase();
  return out;
}

/** 长标题: 只保留冒号/竖杠前面的部分, 逗号改空格。 */
export function formatArticleTitle(title: string, rules: TypesetRules = DEFAULT_RULES): string {
  let t = title.replace(/\s+/g, ' ').trim();
  if (rules.titleCutAtDelimiter) {
    const cut = t.search(/[:：|｜丨]/);
    if (cut > 0) t = t.slice(0, cut).trim();
  }
  if (rules.titleCommaToSpace) t = t.replace(/\s*[，,、]\s*/g, ' ').trim();
  return t;
}

export type StyleRole = 'body' | 'heading' | 'caption' | 'byline';

export function paragraphCss(role: StyleRole, rules: TypesetRules = DEFAULT_RULES): string {
  const base = `color:${rules.textColor};line-height:${rules.lineHeight};letter-spacing:${rules.letterSpacing}px;margin:${rules.paragraphGap}px 0;`;
  if (role === 'heading') return `${base}font-size:${rules.headingSize}px;${rules.headingBold ? 'font-weight:bold;' : ''}`;
  if (role === 'caption') return `${base}font-size:${Math.max(12, rules.bodySize - 2)}px;text-align:center;`;
  if (role === 'byline') return `${base}font-size:${rules.bodySize}px;text-align:right;`;
  return `${base}font-size:${rules.bodySize}px;${rules.firstLineIndent ? 'text-indent:2em;' : ''}`;
}

export const wrapperCss = (rules: TypesetRules = DEFAULT_RULES) => `padding:0 ${rules.sidePadding}px;`;
export const imageCss = (rules: TypesetRules = DEFAULT_RULES) => `display:block;width:${rules.imageWidth}%;max-width:${rules.imageWidth}%;height:auto;margin:0 auto;`;
/** A real spacer, never a bare Enter. */
export const blankLineHtml = (rules: TypesetRules = DEFAULT_RULES) => `<p style="margin:0;line-height:${rules.lineHeight};font-size:${rules.bodySize}px;"><br></p>`;

export interface LintIssue {
  rule: string;
  level: 'error' | 'warn';
  message: string;
  /** Index of the block inside the document, when known. */
  block?: number;
}

function cssOf(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().toLowerCase();
  }
  return out;
}

const hexOf = (value: string | undefined): string | null => {
  if (!value) return null;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map(c => c + c).join('');
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  return rgb ? '#' + [rgb[1], rgb[2], rgb[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('') : null;
};

const isGrayish = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
};

export interface LintBlock {
  html: string;
  /** Template blocks keep their own typography apart from colour and blank lines. */
  strict: boolean;
}

/**
 * Check finished block HTML against the house style. Only text a person can
 * fix is reported; SVG and decorative template text are skipped.
 */
export function lintBlocks(blocks: LintBlock[], rules: TypesetRules = DEFAULT_RULES, meta: { title?: string } = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: string, level: LintIssue['level'], message: string, block?: number) => {
    if (!issues.some(i => i.rule === rule && i.block === block)) issues.push({ rule, level, message, block });
  };
  if (meta.title !== undefined) {
    const formatted = formatArticleTitle(meta.title, rules);
    if (formatted !== meta.title.replace(/\s+/g, ' ').trim()) add('title-long', 'warn', `标题过长或含逗号/冒号后缀，建议改为「${formatted}」`);
  }
  let previous: 'text' | 'image' | 'blank' | null = null;
  const kindOf = (root: ReturnType<typeof parse>): 'text' | 'image' | 'blank' => {
    const text = root.textContent.replace(/[\s​ ]/g, '');
    if (root.querySelector('img') && !text) return 'image';
    return text ? 'text' : 'blank';
  };
  const kinds: Array<'text' | 'image' | 'blank'> = [];
  blocks.forEach((b, index) => {
    const root = parse(b.html);
    const kind = kindOf(root);
    kinds.push(kind);
    // Consecutive Enter-style empty paragraphs.
    const empties = root.querySelectorAll('p').filter(p => !p.textContent.replace(/[\s​ ]/g, '') && !p.querySelector('img'));
    if (empties.length > 1) add('blank-enter', 'warn', '连续空段落看起来是用回车造的空行，请改用前插/后插空行', index);
    for (const el of root.querySelectorAll('img')) {
      const css = cssOf(el.getAttribute('style'));
      const width = css.width ?? css['max-width'];
      if (width && /%$/.test(width) && Math.abs(parseFloat(width) - rules.imageWidth) > 1.5) add('image-width', 'warn', `图片宽度应为 ${rules.imageWidth}%，当前 ${width}`, index);
      if (!width) add('image-width', 'warn', `图片未设置宽度，应为 ${rules.imageWidth}%`, index);
    }
    for (const el of root.querySelectorAll('p,span,h1,h2,h3,h4,h5,h6,section')) {
      if (el.querySelector('svg') || el.closest?.('svg')) continue;
      const own = el.childNodes.some(n => n.nodeType === 3 && n.text.trim());
      if (!own) continue;
      const css = cssOf(el.getAttribute('style'));
      const hex = hexOf(css.color);
      if (hex && hex !== rules.textColor.toLowerCase() && isGrayish(hex) && hex !== '#ffffff') add('text-color', 'warn', `文字应为黑色 ${rules.textColor}，发现深灰 ${hex}`, index);
      if (!b.strict) continue;
      const size = css['font-size'] ? parseFloat(css['font-size']) : undefined;
      if (size !== undefined && ![rules.bodySize, rules.headingSize, Math.max(12, rules.bodySize - 2)].includes(size) && size < 24) add('font-size', 'warn', `字号 ${size}px 不在规范内（正文 ${rules.bodySize}、小标题 ${rules.headingSize}）`, index);
      const lh = css['line-height'] ? parseFloat(css['line-height']) : undefined;
      if (lh !== undefined && !css['line-height'].endsWith('px') && Math.abs(lh - rules.lineHeight) > 0.05) add('line-height', 'warn', `行距应为 ${rules.lineHeight}，当前 ${css['line-height']}`, index);
    }
    // Leading full-width spaces are fake indentation.
    for (const p of root.querySelectorAll('p')) if (/^[　  ]{2,}\S/.test(p.textContent)) add('fake-indent', 'warn', '段首用空格缩进，请改用首行缩进', index);
  });
  if (rules.blankAroundImages) {
    for (let i = 1; i < kinds.length; i++) {
      const a = kinds[i - 1], b = kinds[i];
      if ((a === 'image' && b === 'image') || (a === 'text' && b === 'image') || (a === 'image' && b === 'text')) add('blank-around-image', 'warn', '文字与图片、图片与图片之间需要空一行', i);
    }
  }
  void previous;
  return issues;
}
