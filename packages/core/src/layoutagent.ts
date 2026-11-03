import { parse, type HTMLElement as HNode } from 'node-html-parser';
import { escapeHtml } from './manuscript.ts';
import { isPhotoSrc, KEY_MARK, MARK, parsePlan, stripAgentMarks, UNIT_MARK, type PlanEntry } from './templatefill.ts';
import { blankLineHtml, DEFAULT_RULES, lintBlocks, type TypesetRules } from './typeset.ts';

/**
 * The layout review loop (ReAct). A model looks at the rendered article (a
 * screenshot plus a measured report), thinks, and takes one action per step:
 * re-plan, fix structure, or polish one element. The loop runs in the browser
 * because only a browser can render and measure; everything that decides what
 * an action may do lives here so the web loop and MCP share it.
 *
 * Elements are addressed by number (`data-k`), assigned in document order to
 * the working HTML before every observation. Manuscript content is marked
 * (`data-kiumi`) by the executor; actions that would hide, drop or restyle it
 * against the house rules are refused, and the refusal is the observation.
 */

export type AgentAction =
  | { tool: 'look' }
  | { tool: 'inspect'; k: number }
  | { tool: 'set_plan'; entries: PlanEntry[] }
  | { tool: 'fix_structure'; patches: Array<[number, string]> }
  | { tool: 'style'; k: number; css: Record<string, string> }
  | { tool: 'remove'; k: number }
  | { tool: 'set_text'; k: number; text: string }
  | { tool: 'finish'; summary: string; unresolved?: string };

export interface AgentReply { thought: string; action: AgentAction }

const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^#?\d+$/.test(v) ? Number(v.replace('#', '')) : NaN);

function cssObject(value: unknown): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()]));
  }
  const out: Record<string, string> = {};
  for (const part of String(value ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Read one ReAct step from model output: `{"thought": "...", "action": {"tool": ..., ...}}`. */
export function parseAgentReply(text: string): AgentReply | { error: string } {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return { error: '没有找到 JSON。请只输出 {"thought": "...", "action": {"tool": "..."}}。' };
  let raw: any;
  try { raw = JSON.parse(match[0]); } catch { return { error: 'JSON 无法解析。请只输出一个合法的 JSON 对象。' }; }
  const thought = String(raw.thought ?? '').slice(0, 2000);
  const a = raw.action ?? {};
  const tool = String(a.tool ?? '');
  const k = num(a.k);
  switch (tool) {
    case 'look': return { thought, action: { tool } };
    case 'inspect': case 'remove':
      return Number.isNaN(k) ? { error: `${tool} 需要元素编号 k。` } : { thought, action: { tool, k } };
    case 'style': {
      if (Number.isNaN(k)) return { error: 'style 需要元素编号 k。' };
      const css = cssObject(a.css);
      return Object.keys(css).length ? { thought, action: { tool, k, css } } : { error: 'style 需要 css，例如 {"font-size": "28px"}。' };
    }
    case 'set_text':
      return Number.isNaN(k) || typeof a.text !== 'string' ? { error: 'set_text 需要 k 和 text。' } : { thought, action: { tool, k, text: a.text } };
    case 'set_plan': {
      const entries = parsePlan(a.entries ?? a);
      return entries ? { thought, action: { tool, entries } } : { error: 'set_plan 需要 entries：[{u,t,img}]。' };
    }
    case 'fix_structure': {
      const patches = Array.isArray(a.patches) ? a.patches.filter((p: unknown) => Array.isArray(p) && p.length >= 2).map((p: unknown[]) => [Number(p[0]), String(p[1])] as [number, string]) : [];
      return patches.length ? { thought, action: { tool, patches } } : { error: 'fix_structure 需要 patches：[[段落序号, 角色]]。' };
    }
    case 'finish': return { thought, action: { tool, summary: String(a.summary ?? thought).slice(0, 1000), ...(a.unresolved ? { unresolved: String(a.unresolved).slice(0, 1000) } : {}) } };
    default: return { error: `未知工具「${tool}」。可用：look inspect set_plan fix_structure style remove set_text finish。` };
  }
}

// ---------------------------------------------------------------------------
// Working HTML: numbers and content marks
// ---------------------------------------------------------------------------

/** Number every element in document order (`data-k`), replacing old numbers. */
export function numberElements(html: string): string {
  const root = parse(html.replace(/\sdata-k="[^"]*"/g, ''), { comment: false });
  let k = 0;
  for (const el of root.querySelectorAll('*')) el.setAttribute(KEY_MARK, String(++k));
  return root.toString();
}

const ZWS = /[​‌‍﻿ \s]/g;
const visible = (el: HNode) => el.textContent.replace(ZWS, '');
const marksOf = (el: HNode) => (el.getAttribute?.(MARK) ?? '').split(/\s+/).filter(Boolean);
/** Pieces inside an element (itself included). */
const piecesIn = (el: HNode): string[] => [...marksOf(el), ...el.querySelectorAll(`[${MARK}]`).flatMap(marksOf)];
/** The piece an element belongs to (itself or the nearest marked ancestor). */
function pieceAround(el: HNode): string[] {
  for (let n: HNode | null = el; n; n = n.parentNode as HNode | null) { const m = marksOf(n); if (m.length) return m; }
  return [];
}
const isTitleBlock = (ids: string[]) => ids.length > 0 && ids.every(id => id === 'T' || id === 'S');
const findK = (root: HNode, k: number) => root.querySelector(`[${KEY_MARK}="${k}"]`);
/** Without marks (documents stored before, or MCP), any text or uploaded picture counts as content. */
const heuristicContent = (el: HNode) => !!visible(el) || el.querySelectorAll('img').some(i => /^\/uploads\/|^blob:/.test(i.getAttribute('src') ?? '')) || (/^img$/i.test(el.tagName ?? '') && /^\/uploads\/|^blob:/.test(el.getAttribute('src') ?? ''));

// ---------------------------------------------------------------------------
// Polish actions, validated against the house rules
// ---------------------------------------------------------------------------

const ALLOWED = new Set([
  'font-size', 'color', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-indent', 'white-space', 'word-break',
  'height', 'min-height', 'max-height', 'width', 'min-width', 'max-width',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'overflow', 'overflow-x', 'overflow-y', 'display', 'visibility', 'opacity', 'transform', 'background-color',
  'border', 'border-width', 'border-color', 'border-style', 'border-radius', 'justify-content', 'align-items', 'align-self', 'flex', 'flex-direction', 'flex-wrap', 'vertical-align', 'box-sizing', 'gap', 'top', 'bottom', 'left', 'right',
]);
/** Typography the house rules fix for everything but the title block. */
const RULED = ['color', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-indent'];

export interface PolishContext {
  rules?: TypesetRules;
  /** The article title after the house rules (for set_text on title lines). */
  title?: string;
  subtitle?: string;
}

export type PolishResult = { html: string; done: string } | { error: string };

/** SVG boxes (svg, foreignObject…) are sized by attributes, not CSS: geometry goes to attributes there. */
const SVG_TAG = /^(svg|foreignobject|rect|image|g|use)$/i;
const SVG_GEOMETRY = new Set(['width', 'height', 'x', 'y']);

function setStyle(el: HNode, css: Record<string, string>) {
  if (SVG_TAG.test(el.tagName ?? '')) {
    for (const k of Object.keys(css)) if (SVG_GEOMETRY.has(k)) { el.setAttribute(k, css[k]); delete css[k]; }
    if (!Object.keys(css).length) return;
  }
  const current = cssObject(el.getAttribute('style') ?? '');
  for (const [k, v] of Object.entries(css)) { if (v === '' || v === 'unset') delete current[k]; else current[k] = v; }
  el.setAttribute('style', Object.entries(current).map(([k, v]) => `${k}:${v}`).join(';'));
}

const hides = (k: string, v: string) =>
  (k === 'display' && /none/i.test(v)) || (k === 'visibility' && /hidden|collapse/i.test(v)) || (k === 'opacity' && parseFloat(v) < 0.6) ||
  ((k === 'height' || k === 'max-height') && /^\d+(\.\d+)?px$/.test(v) && parseFloat(v) < 24) || (k === 'transform' && /scale\(\s*0(\.[0-4])?\s*[,)]/i.test(v)) ||
  (k === 'font-size' && parseFloat(v) < 10);

/**
 * Apply one polish action (style / remove / set_text) to the working HTML.
 * Refused, with the reason, when it would remove, hide or rule-break content.
 */
export function applyPolish(html: string, action: AgentAction, ctx: PolishContext = {}): PolishResult {
  const rules = ctx.rules ?? DEFAULT_RULES;
  const root = parse(html, { comment: false });
  const marked = !!root.querySelector(`[${MARK}]`);
  if (!('k' in action)) return { error: '这个动作不修改元素。' };
  const el = findK(root, action.k);
  if (!el) return { error: `没有编号 #${action.k} 的元素（编号会在每次修改后重排，请用最新的观察结果）。` };
  const inside = piecesIn(el);
  const around = pieceAround(el);
  const content = marked ? inside.length > 0 || around.length > 0 : heuristicContent(el);

  if (action.tool === 'remove') {
    if (content) return { error: `#${action.k} 含有稿件内容（${[...new Set([...around, ...inside])].join('、') || '文字或图片'}），不能删除。只能删除装饰、模板样例图和空框。` };
    el.remove();
    return { html: root.toString(), done: `已删除 #${action.k}` };
  }

  if (action.tool === 'style') {
    const titleBlock = marked ? isTitleBlock([...around, ...inside]) : false;
    const contentImage = (/^img$/i.test(el.tagName) && (marked ? around.some(id => /^f\d+$/.test(id)) : heuristicContent(el)));
    for (const [k, v] of Object.entries(action.css)) {
      if (!ALLOWED.has(k)) return { error: `不允许修改 ${k}。可改：${[...ALLOWED].join(' ')}。` };
      if (/url\(|expression|javascript:|@import|[<>]/i.test(v) || v.length > 120) return { error: `${k} 的值不安全或过长。` };
      if (k === 'font-family') return { error: '字体必须是秀米默认字体，不能设置 font-family。' };
      if (content && hides(k, v)) return { error: `#${action.k} 含有稿件内容，不能隐藏、压扁或缩到看不见（${k}: ${v}）。` };
      if (content && !titleBlock && (around.length || !marked) && RULED.includes(k)) {
        return { error: `#${action.k} 是正文/小标题等稿件文字，${k} 由团队规范固定（正文 ${rules.bodySize}px、小标题 ${rules.headingSize}px、黑色、行距 ${rules.lineHeight}、字距 ${rules.letterSpacing}），不能改。可以改它外面的框（高度、边距、溢出）。` };
      }
      if (contentImage && /^(max-)?width$/.test(k) && v !== `${rules.imageWidth}%`) return { error: `稿件图片宽度由规范固定为 ${rules.imageWidth}%。` };
    }
    const said = Object.entries(action.css).map(([k, v]) => `${k}:${v}`).join('; ');
    setStyle(el, { ...action.css });
    return { html: root.toString(), done: `已设置 #${action.k} 的 ${said}${SVG_TAG.test(el.tagName) ? '（SVG 元素的宽高写在属性上）' : ''}` };
  }

  if (action.tool === 'set_text') {
    const ids = marked ? marksOf(el) : [];
    const id = ids[0];
    if (!marked || !id || !['T', 'S', 'L'].includes(id)) return { error: 'set_text 只能用于标题行（T）、副标题（S）和 AI 拟写的小标题条（L）；稿件正文不能改写。' };
    const text = action.text.replace(/\r/g, '').trim();
    const flat = (s: string) => s.replace(/[\s\n]/g, '');
    if (id === 'L' && ([...flat(text)].length > 12 || !text)) return { error: '拟写的小标题不超过 12 字。' };
    if (id === 'S' && ctx.subtitle && flat(text) !== flat(ctx.subtitle.replace(/^[\s—–\-－~～]+/, ''))) return { error: `副标题文字必须是「${ctx.subtitle}」，只能调整换行。` };
    if (id === 'T' && ctx.title) {
      // Title lines may be re-split, never re-worded: all T lines together must still read the title.
      const others = root.querySelectorAll(`[${MARK}="T"]`).filter(x => x !== el).map(x => visible(x)).join('');
      if (flat(others + text) !== flat(ctx.title) && flat(text) !== flat(ctx.title)) return { error: `标题文字必须是「${ctx.title}」（可以用 \\n 换行，或把整句放进一行再清空其他标题行），不能改写。` };
      if (flat(text) === flat(ctx.title)) for (const x of root.querySelectorAll(`[${MARK}="T"]`)) if (x !== el) x.set_content('');
    }
    // Keep the slot's own inline wrappers (colour, bold): replace the text inside the innermost one.
    let target: HNode = el;
    while (target.childNodes.filter(c => c.nodeType === 1).length === 1 && !target.childNodes.some(c => c.nodeType === 3 && c.rawText.trim())) target = target.childNodes.find(c => c.nodeType === 1) as HNode;
    target.set_content(text.split('\n').map(escapeHtml).join('<br>'));
    return { html: root.toString(), done: `已改写 #${action.k} 的文字` };
  }
  return { error: '这个动作不修改元素。' };
}

/** One element's markup and its ancestors' boxes, for `inspect`. */
export function inspectElement(html: string, k: number): string {
  const root = parse(html, { comment: false });
  const el = findK(root, k);
  if (!el) return `没有编号 #${k} 的元素。`;
  const chain: string[] = [];
  for (let n = el.parentNode as HNode | null, depth = 0; n && n.tagName && depth < 5; n = n.parentNode as HNode | null, depth++) {
    chain.push(`#${n.getAttribute(KEY_MARK) ?? '?'} <${n.tagName.toLowerCase()}> ${(n.getAttribute('style') ?? '').slice(0, 160)}`);
  }
  const outer = el.toString().replace(/\sdata-k="(\d+)"/g, ' #$1');
  return [`#${k} <${el.tagName.toLowerCase()}>`, `内容：${piecesIn(el).join(' ') || pieceAround(el).join(' ') || '无（装饰或模板元素）'}`, '外层（由近到远）：', ...chain, '标记（截断到 2500 字）：', outer.slice(0, 2500)].join('\n');
}

// ---------------------------------------------------------------------------
// Findings without a browser (also what MCP Agents get)
// ---------------------------------------------------------------------------

export interface LayoutFinding {
  level: 'error' | 'warn';
  k?: number;
  message: string;
}

/**
 * Problems visible in the markup itself: template sample photos left in the
 * body, empty framed boxes, leftover placeholder padding, and the house-rule
 * lint. A browser adds geometry (clipping, overlap) on top.
 */
export function layoutFindings(html: string, rules: TypesetRules = DEFAULT_RULES): LayoutFinding[] {
  const out: LayoutFinding[] = [];
  const root = parse(html, { comment: false });
  const kOf = (el: HNode) => Number(el.getAttribute(KEY_MARK)) || undefined;
  const marked = !!root.querySelector(`[${MARK}]`);
  for (const img of root.querySelectorAll('img')) {
    if (img.closest('svg')) continue;
    const src = img.getAttribute('src') ?? '';
    const ours = marked ? !!img.getAttribute(MARK) : /^\/uploads\/|^blob:/.test(src);
    const unit = img.closest(`[${UNIT_MARK}]`)?.getAttribute(UNIT_MARK) ?? '';
    if (!ours && isPhotoSrc(src) && !/\btitle\b/.test(unit)) out.push({ level: 'error', k: kOf(img), message: '模板的样例照片还在正文里（不是稿件图片），应删除或换成稿件图片。' });
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg') && !el.closest('foreignobject')) continue;
    const style = el.getAttribute('style') ?? '';
    if (!/border(?!-radius)[^:]*:\s*[^;]*\d|background-color/i.test(style) || /border[^:]*:\s*(none|0)/i.test(style)) continue;
    if (visible(el) || el.querySelector('img') || el.querySelector('svg')) continue;
    if (!/(?:^|;)\s*(height|min-height|padding)\s*:\s*[1-9]/i.test(style)) continue;
    if (el.parentNode && !visible(el.parentNode as HNode) && !(el.parentNode as HNode).querySelector('img')) continue; // only the outermost empty box
    out.push({ level: 'warn', k: kOf(el), message: '空框：有边框或底色但没有内容。' });
  }
  if (/[​]{2,}|​ ​/.test(html)) out.push({ level: 'error', message: '还有模板占位文字没有清掉。' });
  for (const issue of lintBlocks([{ html: stripAgentMarks(html), strict: false }], rules)) {
    // Template art is not held to the picture width; manuscript pictures are checked below.
    if (marked && issue.rule === 'image-width') continue;
    out.push({ level: issue.level === 'error' ? 'error' : 'warn', message: `规范：${issue.message}` });
  }
  if (marked) for (const img of root.querySelectorAll(`img[${MARK}]`)) {
    const width = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(img.getAttribute('style') ?? '')?.[1]?.trim();
    if (width !== `${rules.imageWidth}%` && !/(?:^|;)\s*width\s*:\s*100%/.test(img.getAttribute('style') ?? '')) out.push({ level: 'error', k: kOf(img), message: `稿件图片 ${marksOf(img).join(' ')} 宽度应为 ${rules.imageWidth}%（当前 ${width ?? '未设置'}）。` });
  }
  return out;
}

/** A blank line spacer as the house rules write it (for actions that add space). */
export const agentBlankLine = (rules: TypesetRules = DEFAULT_RULES) => blankLineHtml(rules);
