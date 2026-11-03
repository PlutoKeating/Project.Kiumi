import { parse, type HTMLElement as HNode } from 'node-html-parser';
import { escapeHtml, type Manuscript, type Part } from './manuscript.ts';
import {
  DEFAULT_RULES,
  blankLineHtml,
  formatArticleTitle,
  imageCss,
  paragraphCss,
  type TypesetRules,
} from './typeset.ts';
import { rulesBrief } from './prompts.ts';

/**
 * Pour a manuscript into a recorded style template (a shop article skeleton).
 *
 * Shop templates are placeholders whose text length equals the original copy,
 * so they say nothing about meaning. A Word manuscript rarely has the same
 * shape as the template, so filling is split in two:
 *
 *  1. A *layout plan* says which manuscript pieces go into which template unit.
 *     Units may be reused (cloned) or skipped. The plan comes from a model
 *     (web importer, `planPrompt`), from the user's Agent (MCP), or from the
 *     deterministic `autoPlan`.
 *  2. `executePlan` applies any plan. It never loses content: whatever the plan
 *     leaves out is typeset by the house rules next to its neighbour, and empty
 *     labels/boxes the plan did not use are removed instead of left blank.
 */

export type UnitKind = 'title' | 'subtitle' | 'heading' | 'text' | 'photo' | 'mixed' | 'decor';

export interface ZoneInfo {
  /** Placeholder characters (the original copy length). */
  len: number;
  /** Effective font size (px). */
  size: number;
  bold: boolean;
}

export interface UnitInfo {
  index: number;
  kind: UnitKind;
  /** Placeholder characters per text zone (zones with text only). */
  zones: number[];
  zoneInfo: ZoneInfo[];
  /** Photo-sized <img> slots in the unit. */
  photos: number;
  /** Effective font size of the largest zone (px). */
  size: number;
  bold: boolean;
  /** Mixed units: true when the pictures sit above the text. */
  photoFirst?: boolean;
}

export interface TemplateSchema {
  version: 2;
  units: UnitInfo[];
  /** Counts a caller can show or an Agent can reason about. */
  summary: { text: number; heading: number; photo: number; mixed: number; title: boolean; subtitle: boolean };
}

const SKIP = /^(script|style|svg)$/i;
const ZWS = /[​‌‍﻿ \s]/g;
const NUM_ZONE = 3;
const BODY_ZONE = 40;

const elements = (node: HNode): HNode[] => node.childNodes.filter(c => c.nodeType === 1) as HNode[];

const styleOf = (el: HNode, name: string): string | undefined => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(el.getAttribute?.('style') ?? '');
  return m?.[1].trim();
};

function sizeOf(el: HNode, stop: HNode): number {
  // Walk up multiplying relative sizes; the root base is 16px.
  let factor = 1;
  let absolute: number | undefined;
  for (let n: HNode | null = el; n && !absolute; n = n.parentNode as HNode | null) {
    const v = styleOf(n, 'font-size');
    if (v) {
      const px = /^([\d.]+)px$/.exec(v), pct = /^([\d.]+)%$/.exec(v), em = /^([\d.]+)r?em$/.exec(v);
      if (px) absolute = parseFloat(px[1]);
      else if (pct) factor *= parseFloat(pct[1]) / 100;
      else if (em) factor *= parseFloat(em[1]);
    }
    if (n === stop) break;
  }
  return Math.round((absolute ?? 16) * factor * 10) / 10;
}

interface Zone {
  el: HNode;
  len: number;
  size: number;
  bold: boolean;
  texts: any[];
}

function textZones(unit: HNode): Zone[] {
  const byEl = new Map<HNode, Zone>();
  const order: Zone[] = [];
  const visit = (node: any) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeType === 3) {
        const raw = String(child.rawText ?? '');
        if (!raw.replace(ZWS, '') && !raw.trim()) continue;
        let block: HNode | null = child.parentNode;
        while (block && !/^(p|h[1-6]|li|div|section|td|th)$/i.test(block.tagName ?? '') && block !== unit) block = block.parentNode as HNode | null;
        block = block ?? unit;
        let zone = byEl.get(block);
        if (!zone) {
          zone = { el: block, len: 0, size: sizeOf(child.parentNode as HNode, unit), bold: !!block.querySelector('strong,b') || /bold|[6-9]00/.test(styleOf(block, 'font-weight') ?? ''), texts: [] };
          byEl.set(block, zone);
          order.push(zone);
        }
        zone.len += [...raw.trim()].length;
        zone.texts.push(child);
      } else if (child.nodeType === 1 && /^svg$/i.test(child.tagName ?? '')) {
        // SVG art is skipped, but copy laid out in a foreignObject is ordinary HTML
        // (many shop headers set the article title this way).
        for (const fo of (child as HNode).querySelectorAll('*').filter(e => /^foreignobject$/i.test(e.tagName ?? ''))) visit(fo);
      } else if (child.nodeType === 1 && !SKIP.test(child.tagName ?? '')) visit(child);
    }
  };
  visit(unit);
  return order.filter(z => z.len > 0);
}

/** Photos are sample pictures; ornaments are small png/gif. */
export function isPhotoSrc(src: string): boolean {
  const size = /sz[-_](\d+)/.exec(src);
  const bytes = size ? Number(size[1]) : 0;
  if (/\.gif(?:[?#]|$)/i.test(src)) return false; // animated ornaments
  if (/\.(jpe?g)(?:[?#]|$)/i.test(src)) return bytes === 0 || bytes >= 40_000;
  return bytes >= 120_000;
}

/** Icons drawn at a small fixed size are not photo slots, whatever the file. */
const tiny = (img: HNode) => {
  if (Number(img.getAttribute('width')) > 0 && Number(img.getAttribute('width')) < 160) return true;
  let n: HNode | null = img;
  for (let depth = 0; n && depth < 3; depth++, n = n.parentNode as HNode | null) {
    const w = /(?:^|;)\s*(?:max-)?width\s*:\s*([\d.]+)px/i.exec(n.getAttribute?.('style') ?? '');
    if (w && Number(w[1]) < 160) return true;
  }
  return false;
};

const photoImgs = (unit: HNode) => unit.querySelectorAll('img').filter(i => !i.closest('svg') && !tiny(i) && isPhotoSrc(i.getAttribute('src') ?? i.getAttribute('data-src') ?? ''));

const hasContent = (node: HNode) => photoImgs(node).length > 0 || textZones(node).length > 0;

/** Children laid out side by side must stay together. */
function isRow(node: HNode): boolean {
  const style = node.getAttribute?.('style') ?? '';
  const full = (k: HNode) => /(?:^|;)\s*width\s*:\s*(9[5-9]|100)(\.\d+)?%/i.test(k.getAttribute?.('style') ?? '');
  const kids = elements(node).filter(hasContent);
  if (/display\s*:\s*(inline-)?flex/i.test(style) && !/flex-direction\s*:\s*column/i.test(style) && !kids.every(full)) return true;
  if (/^(tr|table|tbody)$/i.test(node.tagName ?? '') || /display\s*:\s*table(-row)?\b/i.test(style)) return true;
  const sideBySide = elements(node).filter(k => {
    const s = k.getAttribute?.('style') ?? '';
    const width = /(?:^|;)\s*width\s*:\s*([\d.]+)%/i.exec(s);
    return /display\s*:\s*(inline-block|inline-flex|table-cell)|float\s*:\s*(left|right)/i.test(s) || (width && Number(width[1]) <= 60);
  });
  return sideBySide.length >= 2;
}

/** A unit holding several independent content groups is cut into its children. */
function shouldSplit(node: HNode): HNode | null {
  let n = node;
  for (;;) {
    const contentKids = elements(n).filter(hasContent);
    if (contentKids.length === 1) { n = contentKids[0]; continue; }
    if (contentKids.length < 2 || isRow(n)) return null;
    const photos = photoImgs(n).length;
    const body = textZones(n).filter(z => z.len >= BODY_ZONE).length;
    return photos >= 2 || body >= 2 || (photos >= 1 && body >= 1 && contentKids.length >= 3) ? n : null;
  }
}

function wrapperOf(root: HNode): HNode {
  let node = root;
  for (;;) {
    const kids = elements(node);
    if (kids.length !== 1) return node;
    node = kids[0];
  }
}

/** Leaf units in document order. Containers stay in the DOM around them. */
function discoverUnits(html: string): { root: HNode; units: HNode[] } {
  const root = parse(html, { comment: false });
  const units: HNode[] = [];
  const walk = (node: HNode) => {
    const container = shouldSplit(node);
    if (container) for (const child of elements(container)) walk(child);
    else units.push(node);
  };
  for (const unit of elements(wrapperOf(root))) walk(unit);
  return { root, units };
}

function describeUnit(u: HNode, index: number): UnitInfo {
  const zones = textZones(u);
  const photos = photoImgs(u).length;
  const longest = Math.max(0, ...zones.map(z => z.len));
  const top = zones.slice().sort((a, b) => b.size - a.size)[0];
  let kind: UnitKind;
  if (!zones.length && !photos) kind = 'decor';
  else if (photos) kind = longest <= 8 ? 'photo' : 'mixed';
  else if (longest <= NUM_ZONE) kind = 'decor';
  else kind = longest >= BODY_ZONE ? 'text' : 'heading';
  const html = u.toString();
  const firstText = zones[0] ? html.indexOf(String(zones[0].texts[0]?.rawText ?? '').slice(0, 4)) : -1;
  return {
    index,
    kind,
    zones: zones.map(z => z.len),
    zoneInfo: zones.map(z => ({ len: z.len, size: z.size, bold: z.bold })),
    photos,
    size: top?.size ?? 0,
    bold: !!top?.bold,
    photoFirst: photos > 0 ? firstText < 0 || html.indexOf('<img') < firstText : undefined,
  };
}

function schemaOf(units: HNode[]): TemplateSchema {
  const infos = units.map(describeUnit);
  const content = infos.filter(i => i.kind !== 'decor');
  const sizes = infos.filter(i => i.kind === 'text' || i.kind === 'heading').map(i => i.size).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 16;
  // Title: among the first content units, text that is clearly larger than the rest.
  // A header card (art plus the title, often in an SVG foreignObject) counts too.
  const title = content.slice(0, 3).find(i => (i.kind === 'heading' || i.kind === 'text' || i.kind === 'mixed') && i.size >= Math.max(median * 1.3, 20) && Math.max(...i.zoneInfo.filter(z => z.size >= i.size * 0.75).map(z => z.len)) <= 60);
  if (title) {
    title.kind = 'title';
    // Pictures in the title card are its artwork, never photo slots.
    title.photos = 0;
    delete title.photoFirst;
    const next = content[content.indexOf(title) + 1];
    if (next && next.kind === 'heading' && next.zones.length === 1 && next.zones[0] <= 40 && next.size < title.size) next.kind = 'subtitle';
  }
  const count = (k: UnitKind) => infos.filter(i => i.kind === k).length;
  return {
    version: 2,
    units: infos,
    summary: {
      text: count('text'),
      heading: count('heading'),
      photo: infos.reduce((n, i) => n + (i.kind === 'photo' || i.kind === 'mixed' ? Math.max(i.photos, 1) : 0), 0),
      mixed: count('mixed'),
      title: !!title,
      subtitle: count('subtitle') > 0,
    },
  };
}

export function analyzeTemplate(html: string): TemplateSchema {
  return schemaOf(discoverUnits(html).units);
}

// ---------------------------------------------------------------------------
// Manuscript pieces addressed by short ids
// ---------------------------------------------------------------------------

export type PieceKind = 'title' | 'subtitle' | 'byline' | 'heading' | 'para' | 'caption' | 'image';

export interface Piece {
  /** T, S, Y, h0…, p0…, c0…, f0… */
  id: string;
  kind: PieceKind;
  text: string;
  /** Typeset HTML for text pieces; the image reference for images. */
  html: string;
  ref?: string;
}

const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function bylineText(m: Manuscript): string {
  if (!m.byline) return '';
  const parts = [m.byline.writer && `文：${m.byline.writer}`, m.byline.photographer && `图：${m.byline.photographer}`, m.byline.editor && `编辑：${m.byline.editor}`].filter(Boolean);
  return parts.length ? parts.join(' ') : m.byline.text;
}

/** Every piece of the manuscript in reading order. */
export function manuscriptPieces(m: Manuscript, rules: TypesetRules = DEFAULT_RULES): Piece[] {
  const pieces: Piece[] = [];
  const n = { h: 0, p: 0, c: 0, f: 0 };
  if (m.title) pieces.push({ id: 'T', kind: 'title', text: m.title, html: escapeHtml(m.title) });
  if (m.subtitle) pieces.push({ id: 'S', kind: 'subtitle', text: m.subtitle, html: `<p style="${paragraphCss('caption', rules)}">${escapeHtml(m.subtitle)}</p>` });
  const para = (part: Part): string => {
    if (part.type === 'p' || part.type === 'quote') {
      // Keep inline emphasis, drop everything else about presentation.
      const inner = part.html.replace(/<img\b[^>]*>/gi, '').replace(/^\s*<p[^>]*>/i, '').replace(/<\/p>\s*$/i, '');
      return `<p style="${paragraphCss('body', rules)}">${inner}</p>`;
    }
    return part.type === 'table' || part.type === 'list' ? part.html : '';
  };
  for (const section of m.sections) {
    if (section.heading) pieces.push({ id: `h${n.h++}`, kind: 'heading', text: section.heading, html: `<p style="${paragraphCss('heading', rules)}">${escapeHtml(section.heading)}</p>` });
    for (const part of section.parts) {
      if (part.type === 'figure') {
        for (const ref of part.images) pieces.push({ id: `f${n.f++}`, kind: 'image', text: '', html: ref, ref });
        if (part.caption) pieces.push({ id: `c${n.c++}`, kind: 'caption', text: part.caption, html: `<p style="${paragraphCss('caption', rules)}">${escapeHtml(part.caption)}</p>` });
      } else {
        const html = para(part);
        if (html) pieces.push({ id: `p${n.p++}`, kind: 'para', text: plain(html), html });
      }
    }
  }
  const by = bylineText(m);
  if (by) pieces.push({ id: 'Y', kind: 'byline', text: by, html: `<p style="${paragraphCss('byline', rules)}">${escapeHtml(by)}</p>` });
  return pieces;
}

// ---------------------------------------------------------------------------
// Layout plan
// ---------------------------------------------------------------------------

/**
 * One template unit instance. `u` is the unit index; using an index again
 * clones that unit. `t` maps a text zone index to piece ids, or to a short
 * literal (a model-written label such as a section heading). `img` lists image
 * piece ids for the unit's photo slots.
 */
export interface PlanEntry {
  u: number;
  t?: Record<string, string[] | string>;
  img?: string[];
}

export type PlanSource = 'model' | 'agent' | 'auto';

const mainZone = (info: UnitInfo, min = NUM_ZONE + 1): number => {
  let best = -1;
  info.zones.forEach((len, i) => { if (len >= min && (best < 0 || len > info.zones[best])) best = i; });
  return best;
};

/**
 * Zones of a title unit that carry the headline: about as large as the biggest
 * line. A clearly smaller line beside them (a tag or pill) is a subtitle slot,
 * not the second half of the title.
 */
function headlineZones(zones: Array<{ len: number; size: number }>): number[] {
  const top = Math.max(0, ...zones.filter(z => z.len > NUM_ZONE).map(z => z.size));
  return zones.map((z, i) => (z.len > NUM_ZONE && z.size >= top * 0.75 ? i : -1)).filter(i => i >= 0);
}

/** The smaller line of a title unit for the subtitle: the first one after the headline, else one before it. */
const titleSubZone = (info: UnitInfo): number => {
  const head = headlineZones(info.zoneInfo);
  const last = Math.max(-1, ...head);
  const free = info.zoneInfo.map((z, i) => (z.len > NUM_ZONE && !head.includes(i) ? i : -1)).filter(i => i >= 0);
  return free.find(i => i > last) ?? free[0] ?? -1;
};

/** A subtitle set in a template's tag or pill drops its leading dash. */
const undash = (text: string) => text.replace(/^[\s—–\-－~～]+/, '').trim() || text;

/** Deterministic plan: walk the manuscript and take the next unit that fits each piece. */
export function autoPlan(schema: TemplateSchema, pieces: Piece[]): PlanEntry[] {
  const entries: PlanEntry[] = [];
  const units = schema.units;
  const title = units.find(u => u.kind === 'title');
  const subtitle = units.find(u => u.kind === 'subtitle');
  const after = Math.max(title?.index ?? -1, subtitle?.index ?? -1);
  const body = units.filter(u => u.index > after && ['heading', 'text', 'photo', 'mixed'].includes(u.kind));
  const loop = Math.max(0, body.findIndex(u => u.kind === 'heading'));
  let p = 0;
  const find = (ok: (u: UnitInfo) => boolean): UnitInfo | undefined => {
    for (let i = p; i < body.length; i++) if (ok(body[i])) { p = i + 1; return body[i]; }
    // Out of template: reuse the repeating part (from the first section heading), then anything earlier.
    for (let i = loop; i < Math.min(p, body.length); i++) if (ok(body[i])) { p = i + 1; return body[i]; }
    for (let i = 0; i < Math.min(loop, p, body.length); i++) if (ok(body[i])) { p = i + 1; return body[i]; }
    return undefined;
  };

  const byId = new Map(pieces.map(x => [x.id, x]));
  if (title && byId.has('T')) {
    const entry: PlanEntry = { u: title.index, t: { [String(headlineZones(title.zoneInfo)[0] ?? Math.max(0, mainZone(title, 1)))]: ['T'] } };
    // No subtitle unit of its own: the smaller line under the headline takes it.
    const sub = titleSubZone(title);
    if (!subtitle && byId.has('S') && sub >= 0) entry.t![String(sub)] = ['S'];
    entries.push(entry);
  }
  if (subtitle && byId.has('S')) entries.push({ u: subtitle.index, t: { [String(Math.max(0, mainZone(subtitle, 1)))]: ['S'] } });

  // Reading-order segments.
  type Seg = { type: 'h' | 'text' | 'img'; ids: string[] };
  const segs: Seg[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'title' || piece.kind === 'subtitle') continue;
    const type = piece.kind === 'heading' ? 'h' : piece.kind === 'image' ? 'img' : 'text';
    const last = segs.at(-1);
    if (last && last.type === type && type !== 'h') last.ids.push(piece.id);
    else segs.push({ type, ids: [piece.id] });
  }

  let pendingHeading: string[] = [];
  let openMixed: { entry: PlanEntry; info: UnitInfo } | null = null;
  let lastText: string[] | null = null;
  for (const seg of segs) {
    if (seg.type === 'h') {
      openMixed = null;
      const unit = find(u => u.kind === 'heading');
      if (unit) entries.push({ u: unit.index, t: { [String(mainZone(unit))]: seg.ids } });
      else pendingHeading.push(...seg.ids);
    } else if (seg.type === 'text') {
      const ids = [...pendingHeading, ...seg.ids];
      pendingHeading = [];
      if (openMixed && openMixed.info.photoFirst !== false && mainZone(openMixed.info) >= 0) {
        (openMixed.entry.t ??= {})[String(mainZone(openMixed.info))] = ids;
        lastText = ids;
        openMixed = null;
        continue;
      }
      openMixed = null;
      const unit = find(u => u.kind === 'text') ?? find(u => u.kind === 'mixed' && mainZone(u, BODY_ZONE) >= 0);
      if (!unit) continue; // the executor sets it beside its neighbour
      const entry: PlanEntry = { u: unit.index, t: { [String(mainZone(unit))]: ids } };
      entries.push(entry);
      lastText = entry.t![String(mainZone(unit))] as string[];
    } else {
      const ids = seg.ids.slice();
      while (ids.length) {
        const unit = find(u => (u.kind === 'photo' || u.kind === 'mixed') && u.photos > 0 && u.photos <= ids.length) ?? find(u => (u.kind === 'photo' || u.kind === 'mixed') && u.photos > 0);
        if (!unit) break;
        const entry: PlanEntry = { u: unit.index, img: ids.splice(0, unit.photos) };
        entries.push(entry);
        openMixed = unit.kind === 'mixed' ? { entry, info: unit } : null;
      }
    }
  }
  if (pendingHeading.length && lastText) lastText.push(...pendingHeading);
  return entries;
}

/**
 * Compact prompt for a model: template units and manuscript pieces, one line
 * each, so a whole article costs a few thousand tokens.
 */
export function planPrompt(schema: TemplateSchema, pieces: Piece[], clip = 30, rules?: TypesetRules): string {
  const unitLines = schema.units.filter(u => u.kind !== 'decor').map(u => {
    const zones = u.zoneInfo.map((z, i) => `z${i}:${z.len}字${z.size >= 18 ? `/${Math.round(z.size)}px` : ''}${z.bold ? '粗' : ''}`).join(' ');
    const photos = u.photos ? ` 图位${u.photos}${u.kind === 'mixed' ? (u.photoFirst ? '(图在上)' : '(图在下)') : ''}` : '';
    return `u${u.index} ${u.kind}${photos}${zones ? ' ' + zones : ''}`;
  });
  const pieceLines = pieces.map(x => {
    if (x.kind === 'image') return `${x.id} 图片`;
    const label = { title: '主标题', subtitle: '副标题', byline: '署名', heading: '小标题', para: '正文', caption: '图注' }[x.kind];
    const text = x.text.length > clip * 2 ? `${x.text.slice(0, clip)}…${x.text.slice(-8)}` : x.text;
    return `${x.id} ${label} ${x.text.length}字 ${text}`;
  });
  return [
    '把一篇稿件排进公众号风格模板。模板由单元组成，每个单元有若干文字区 z（字数为模板原文案长度）和图片位。',
    '单元类型：title 大标题、subtitle 副标题、heading 小标题条、text 正文区、photo 图片、mixed 图文卡片。未列出的是装饰，自动保留。',
    '要求：',
    '1. 按稿件顺序输出单元实例；同一个单元可以重复使用（会复制一份），不需要的单元不要列出（会删除）。',
    '2. 每个稿件编号必须且只能出现一次；不得改写正文。正文、图注、署名放进字数较多的文字区，可以把连续几段放进同一个区。',
    '3. 图片编号只能放进有图片位的单元，数量不超过图片位；图文卡片的文字区放紧挨图片的正文。',
    '4. 小标题条（heading）若稿件没有对应小标题，可以按下面正文拟写一个不超过该区字数、不超过 12 字的短标题，直接写文字；不要编造事实。2-3 字的编号区可写 01、02…。',
    '5. 尽量让稿件结构与模板节奏一致：图文交替、每个小标题条后跟正文或图片。',
    '6. title 单元里字号明显较小的文字区（标签、胶囊）放副标题 S，不要拿来放主标题的后半句；模板没有副标题位时不要列出 S，排版器会把它醒目地排在标题下方。',
    '只输出 JSON：{"entries":[{"u":单元号,"t":{"区号":["编号",…] 或 "拟写文字"},"img":["f0",…]}]}',
    ...(rules ? [rulesBrief(rules), '格式由排版器按规范强制写入，方案只决定放置；提交后会被程序复核，不合格会被退回。'] : []),
    '模板：',
    ...unitLines,
    '稿件：',
    ...pieceLines,
  ].join('\n');
}

/** Read a plan from model or Agent output. Returns null when nothing usable is there. */
export function parsePlan(input: unknown): PlanEntry[] | null {
  let value = input;
  if (typeof value === 'string') {
    const match = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(value);
    if (!match) return null;
    try { value = JSON.parse(match[0]); } catch { return null; }
  }
  const list = Array.isArray(value) ? value : (value as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) return null;
  const out: PlanEntry[] = [];
  for (const raw of list.slice(0, 400)) {
    if (!raw || typeof raw !== 'object') continue;
    const u = Number((raw as PlanEntry).u);
    if (!Number.isInteger(u) || u < 0) continue;
    const entry: PlanEntry = { u };
    const t = (raw as PlanEntry).t;
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      entry.t = {};
      for (const [k, v] of Object.entries(t)) {
        if (!/^\d+$/.test(k)) continue;
        if (typeof v === 'string' && v.trim()) entry.t[k] = v.trim().slice(0, 40);
        else if (Array.isArray(v)) entry.t[k] = v.map(String).slice(0, 200);
      }
    }
    const img = (raw as PlanEntry).img;
    if (Array.isArray(img)) entry.img = img.map(String).slice(0, 40);
    out.push(entry);
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Plan review: the mandatory check every model or Agent plan goes through
// ---------------------------------------------------------------------------

export interface PlanIssue {
  /** Errors send the plan back; warnings are reported with the result. */
  level: 'error' | 'warn';
  message: string;
}

/**
 * Check a plan against the template, the manuscript and the house rules a plan
 * can break (content dropped or repeated, the title split into the subtitle
 * slot, made-up text outside heading bars, overlong labels, pictures in text
 * zones). Formatting itself is enforced by the executor, not checked here.
 */
export function reviewPlan(schema: TemplateSchema, pieces: Piece[], plan: PlanEntry[]): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const error = (message: string) => issues.push({ level: 'error', message });
  const byId = new Map(pieces.map(p => [p.id, p]));
  const count = new Map<string, number>();
  const see = (id: string) => count.set(id, (count.get(id) ?? 0) + 1);
  const title = schema.units.find(u => u.kind === 'title');
  if (!plan.length) error('方案是空的。');
  plan.forEach((entry, k) => {
    const info = schema.units[entry.u];
    const at = `第 ${k + 1} 项（u${entry.u}）`;
    if (!info) { error(`${at}：模板没有这个单元。`); return; }
    if (info.kind === 'decor') { error(`${at}：这是装饰单元，不能放内容。`); return; }
    const head = headlineZones(info.zoneInfo);
    for (const [key, value] of Object.entries(entry.t ?? {})) {
      const zi = Number(key), len = info.zones[zi];
      if (len === undefined) { error(`${at}：没有文字区 z${key}。`); continue; }
      if (typeof value === 'string') {
        if (len <= NUM_ZONE) continue; // number badges: 01, 02…
        if (info.kind !== 'heading') error(`${at} z${key}：只有小标题条（heading）可以拟写文字，这里必须放稿件编号。`);
        else if ([...value].length > Math.min(12, len + 4)) error(`${at} z${key}：拟写的「${value}」超过 ${Math.min(12, len + 4)} 字。`);
        continue;
      }
      for (const id of value) {
        const p = byId.get(id);
        if (!p) { error(`${at} z${key}：稿件里没有编号 ${id}。`); continue; }
        see(id);
        if (p.kind === 'image') error(`${at} z${key}：图片 ${id} 不能放进文字区，请放进 img。`);
        else if (p.kind === 'title') {
          if (title && info.kind !== 'title') error(`${at}：主标题 T 必须放进标题单元 u${title.index}。`);
          else if (info.kind === 'title' && head.length && !head.includes(zi)) error(`${at}：主标题 T 只能放进大字区 z${head[0]}，z${key} 是副标题位。`);
        } else if (p.kind === 'subtitle') {
          const sub = info.kind === 'title' ? titleSubZone(info) : -1;
          if (info.kind === 'title' && head.includes(zi)) error(`${at}：副标题 S 不能占主标题的大字区${sub >= 0 ? `，请放进小字区 z${sub}` : ''}。`);
        } else if (p.kind === 'para' && (info.kind === 'heading' || info.kind === 'title' || info.kind === 'subtitle')) {
          error(`${at}：正文 ${id} 不能放进${info.kind === 'heading' ? '小标题条' : '标题区'}，请放进 text 或 mixed 单元。`);
        }
      }
    }
    const imgs = entry.img ?? [];
    for (const id of imgs) {
      const p = byId.get(id);
      if (!p) error(`${at}：稿件里没有图片 ${id}。`);
      else if (p.kind !== 'image') error(`${at}：${id} 不是图片，不能放进图片位。`);
      else see(id);
    }
    if (imgs.length > info.photos) error(`${at}：这个单元只有 ${info.photos} 个图片位，放了 ${imgs.length} 张。`);
  });
  for (const [id, n] of count) if (n > 1) error(`编号 ${id} 出现了 ${n} 次，每个编号只能出现一次。`);
  const subtitleSlot = schema.summary.subtitle || (title ? titleSubZone(title) >= 0 : false);
  const missing = pieces.filter(p => !count.has(p.id) && !(p.kind === 'title' && !title) && !(p.kind === 'subtitle' && !subtitleSlot));
  if (missing.length) error(`以下编号没有排进方案：${missing.map(p => p.id).join('、')}。每个编号都必须出现一次。`);
  return issues;
}

/** Follow-up prompt for a review round: the original task, the rejected plan and what is wrong with it. */
export function reviewPrompt(prompt: string, plan: PlanEntry[], issues: PlanIssue[]): string {
  return [
    prompt,
    '',
    '你上一次给出的方案：',
    JSON.stringify({ entries: plan }),
    '程序复核发现以下问题，必须全部改正，同时继续满足团队排版规范：',
    ...issues.map((x, i) => `${i + 1}. ${x.message}`),
    '请重新输出完整方案（只输出 JSON）。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface FillOptions {
  rules?: TypesetRules;
  /** Turn an image reference from the manuscript into a URL. */
  resolveImage?: (ref: string) => string | null;
  /** A plan from a model or Agent; without one (or when it is unusable) `autoPlan` is used. */
  plan?: PlanEntry[] | null;
  planSource?: PlanSource;
  /**
   * Keep the content marks in the output (`data-kiumi` piece ids on the
   * elements that hold manuscript content, `data-kiumi-u` on unit instances),
   * for the layout review loop. Off by default: published HTML carries none.
   */
  mark?: boolean;
}

/** Piece ids on content elements: T, S, Y, L (model label), h0…, p0…, c0…, f0… (space separated). */
export const MARK = 'data-kiumi';
/** Unit instance and kind: "u3 heading". */
export const UNIT_MARK = 'data-kiumi-u';
/** Element numbers the layout reviewer refers to. */
export const KEY_MARK = 'data-k';
export const stripAgentMarks = (html: string) => html.replace(/\s(?:data-kiumi(?:-u)?|data-k)="[^"]*"/g, '');

export interface FillReport {
  title: boolean;
  subtitle: boolean;
  paragraphs: number;
  images: number;
  removedUnits: number;
  clonedUnits: number;
  /** Pieces the template could not hold, typeset beside their neighbours. */
  spilled: number;
  /** Labels written by the model rather than taken from the manuscript. */
  generated: string[];
  plan: PlanSource;
  warnings: string[];
}

const FLIP = /(rotate[XYZ]?\(\s*-?180deg\s*\)|scale[XY]?\(\s*-1|matrix\(\s*-1)/i;

const stripFlip = (n: HNode) => {
  const style = n.getAttribute?.('style');
  if (style && FLIP.test(style)) n.setAttribute('style', style.replace(/(^|;)\s*(-webkit-)?transform\s*:[^;]*/gi, '$1'));
};

/**
 * Templates mirror whole cards (rotateY(180deg)) and mirror the copy back inside.
 * Once the copy is replaced the inner half is gone, so every element that holds
 * content loses its flip; pure ornaments keep theirs.
 */
function unflipContent(unit: HNode) {
  for (const el of [unit, ...unit.querySelectorAll('*')]) {
    if (el.closest?.('svg') && el.tagName?.toLowerCase() !== 'svg') continue;
    if (!FLIP.test(el.getAttribute?.('style') ?? '')) continue;
    if (visibleText(el) || el.querySelector?.('img') || el.tagName?.toLowerCase() === 'img') stripFlip(el);
  }
}

function unfreezeHeights(el: HNode, top: HNode) {
  for (let n: HNode | null = el; n; n = n.parentNode as HNode | null) {
    const style = n.getAttribute?.('style');
    if (style && /height|overflow\s*:\s*hidden/.test(style)) {
      n.setAttribute('style', style.replace(/(^|;)\s*(max-)?height\s*:[^;]*/gi, '$1').replace(/overflow\s*:\s*hidden/gi, 'overflow:visible'));
    }
    if (n === top) break;
  }
}

function setLine(zone: Zone, line: string) {
  const [first, ...rest] = zone.texts;
  if (first) first.rawText = escapeHtml(line);
  for (const t of rest) t.rawText = '';
}

/** Is the zone already inside a padded or coloured box of the template? */
function boxed(el: HNode, unit: HNode): boolean {
  for (let n: HNode | null = el; n; n = n.parentNode as HNode | null) {
    if (/padding|background|border/i.test(n.getAttribute?.('style') ?? '')) return true;
    if (n === unit) break;
  }
  return false;
}

function setBlock(zone: Zone, unit: HNode, html: string, rules: TypesetRules, ids = '') {
  const pad = boxed(zone.el, unit) ? 0 : rules.sidePadding;
  const content = `<section${ids ? ` ${MARK}="${ids}"` : ''} style="padding:0 ${pad}px;text-align:left;">${html}</section>`;
  dropInheritedFont(zone.el, unit);
  const paragraph = /^(p|h[1-6]|li)$/i.test(zone.el.tagName);
  if (zone.el === unit) {
    // The unit is the template paragraph itself: it becomes a plain box, so our
    // paragraphs are not nested in a <p> and keep the rule's paragraph gap.
    if (paragraph) { unit.tagName = 'section'; dropCss(unit, ['margin', 'margin-top', 'margin-bottom']); }
    unit.set_content(content);
  } else if (paragraph) zone.el.replaceWith(content);
  else zone.el.set_content(content);
}

const visibleText = (el: HNode) => el.textContent.replace(ZWS, '');

/** Remove an unused zone together with the label box around it. */
function dropZone(zone: Zone, unit: HNode) {
  for (const t of zone.texts) t.rawText = '';
  let box = zone.el;
  while (box !== unit && box.parentNode && box.parentNode !== unit) {
    const parent = box.parentNode as HNode;
    if (visibleText(parent) || parent.querySelector('img')) break;
    box = parent;
  }
  if (box !== unit && !visibleText(box) && !box.querySelector('img')) box.remove();
}

function fillPhotos(unit: HNode, urls: string[], rules: TypesetRules): number {
  const imgs = photoImgs(unit);
  let used = 0;
  imgs.forEach((img, i) => {
    if (i < urls.length) {
      img.setAttribute('src', urls[i]);
      img.removeAttribute('data-src');
      img.removeAttribute('srcset');
      img.removeAttribute('width');
      img.removeAttribute('height');
      // Sample pictures are often sized by their own pixels. A single picture
      // takes the rule width itself (宽度 90%); photos side by side fill their column.
      const style = (img.getAttribute('style') ?? '').replace(/(^|;)\s*(max-)?(width|height)\s*:[^;]*/gi, '$1').replace(/;{2,}/g, ';');
      const width = imgs.length === 1 ? `width:${rules.imageWidth}%;max-width:${rules.imageWidth}%;margin-left:auto;margin-right:auto;` : 'width:100%;max-width:100%;';
      img.setAttribute('style', `${style};${width}height:auto;display:block;`.replace(/^;+/, ''));
      used++;
    } else {
      const holder = img.parentNode as HNode;
      (holder && holder !== unit && holder.querySelectorAll('img').length === 1 && !visibleText(holder) ? holder : img).remove();
    }
  });
  if (imgs.length === 1 && urls.length >= 1) {
    // The holder spans the slot so 90% is measured against the slot, not a sample's pixel box.
    for (let n = imgs[0].parentNode as HNode | null; n && n !== unit; n = n.parentNode as HNode | null) {
      if (visibleText(n)) break;
      const s = n.getAttribute?.('style') ?? '';
      if (/(?:^|;)\s*width\s*:\s*([\d.]+px|auto)/i.test(s)) n.setAttribute('style', s.replace(/(^|;)\s*width\s*:\s*([\d.]+px|auto)/gi, '$1width:100%'));
      else if (/display\s*:\s*inline-(block|flex)/i.test(s) && !/(?:^|;)\s*width\s*:/i.test(s)) addCss(n, 'width:100%;');
    }
  }
  return used;
}

/** Split a title at the space nearest its middle (commas became spaces under the house rules). */
function halves(title: string): [string, string] | null {
  if (!title.includes(' ')) return null;
  const mid = title.length / 2;
  const cut = [...title].map((c, i) => (c === ' ' ? i : -1)).filter(i => i >= 0).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  return [title.slice(0, cut).trim(), title.slice(cut + 1).trim()];
}

/**
 * Write the title over the headline zones: one half each, or two lines in one
 * zone when it outgrows it. Returns how many zones it used.
 */
function setTitle(title: string, zones: Zone[]): number {
  const split = halves(title);
  if (zones.length >= 2 && split) {
    setLine(zones[0], split[0]);
    setLine(zones[1], split[1]);
    return 2;
  }
  const zone = zones[0];
  if (!zone) return 0;
  setLine(zone, title);
  if (split && [...title].length > zone.len + 2) zone.texts[0].rawText = `${escapeHtml(split[0])}<br>${escapeHtml(split[1])}`;
  return 1;
}

// ---------------------------------------------------------------------------
// House rules on template text: everything except the article title is black,
// in the default font, line height and letter spacing of the rules.
// ---------------------------------------------------------------------------

const TYPO = ['color', 'font-size', 'font-family', 'line-height', 'letter-spacing', 'font-weight'];

function dropCss(el: HNode, names: string[]) {
  const style = el.getAttribute?.('style');
  if (!style) return;
  const kept = style.split(';').filter(d => { const k = d.split(':')[0]?.trim().toLowerCase(); return d.trim() && !names.includes(k); });
  el.setAttribute('style', kept.join(';'));
}

const addCss = (el: HNode, css: string) => el.setAttribute('style', `${(el.getAttribute('style') ?? '').replace(/;?\s*$/, '')};${css}`.replace(/^;/, ''));

/** Inherited template fonts must not reach filled text (秀米默认字体). */
function dropInheritedFont(el: HNode, unit: HNode) {
  for (let n: HNode | null = el; n; n = n.parentNode as HNode | null) {
    dropCss(n, ['font-family']);
    if (n === unit) break;
  }
}

const luminance = (value: string | undefined): number | null => {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) rgb = (hex[1].length === 3 ? [...hex[1]].map(c => c + c) : hex[1].match(/../g)!).map(h => parseInt(h, 16));
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (fn) rgb = [fn[1], fn[2], fn[3]].map(Number);
  if (v === 'white' || v === '#fff') rgb = [255, 255, 255];
  return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : null;
};

/** The colour the template gives a line of text (own, inner or inherited). */
function textColorOf(el: HNode, unit: HNode): string | undefined {
  for (const d of [el, ...el.querySelectorAll('*')]) { const c = styleOf(d, 'color'); if (c && visibleText(d)) return c; }
  for (let n: HNode | null = el.parentNode as HNode | null; n; n = n.parentNode as HNode | null) {
    const c = styleOf(n, 'color');
    if (c) return c;
    if (n === unit) break;
  }
  return undefined;
}

/**
 * A short line we wrote into the template (section heading, subtitle, label,
 * short caption): black, default font, rule line height and spacing; headings
 * at heading size and bold, other lines keep the slot's size. Light text the template sets on a colour band keeps its colour,
 * since black would vanish into the band.
 */
function conformLine(zone: Zone, unit: HNode, role: 'heading' | 'line', rules: TypesetRules) {
  const light = (luminance(textColorOf(zone.el, unit)) ?? 0) > 0.8;
  const strip = role === 'line' ? TYPO.filter(k => k !== 'font-size') : TYPO;
  for (const el of [zone.el, ...zone.el.querySelectorAll('*')]) dropCss(el, light ? strip.filter(k => k !== 'color') : strip);
  dropInheritedFont(zone.el, unit);
  const css = [
    light ? '' : `color:${rules.textColor};`,
    `line-height:${rules.lineHeight};letter-spacing:${rules.letterSpacing}px;`,
    role === 'heading' ? `font-size:${rules.headingSize}px;${rules.headingBold ? 'font-weight:bold;' : ''}` : '',
  ].join('');
  addCss(zone.el, css);
}

/**
 * The template's own colour for title-block lines it has no slot for: the first
 * clearly coloured text (not black, grey or white), else the rule colour.
 */
function templateAccent(node: HNode, fallback: string): string {
  for (const el of node.querySelectorAll('*')) {
    if (el.closest?.('svg') && !el.closest?.('foreignobject')) continue;
    const c = styleOf(el, 'color');
    if (!c || !visibleText(el)) continue;
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c) ?? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
    if (!m) continue;
    const rgb = m[0].startsWith('#') ? [m[1], m[2], m[3]].map(h => parseInt(h, 16)) : [m[1], m[2], m[3]].map(Number);
    const l = luminance(c) ?? 0;
    if (Math.max(...rgb) - Math.min(...rgb) > 40 && l < 0.8) return c;
  }
  return fallback;
}

/** A blank line (the template's or ours): no text, no picture, nothing drawn. */
function isSpacer(el: HNode): boolean {
  if (!/^(p|section|div)$/i.test(el.tagName ?? '')) return false;
  if (visibleText(el) || el.querySelector('img') || el.querySelector('svg')) return false;
  for (const n of [el, ...el.querySelectorAll('*')]) if (/background|border|box-shadow|(?:^|;)\s*(min-)?height\s*:\s*[1-9]/i.test(n.getAttribute?.('style') ?? '')) return false;
  return /^p$/i.test(el.tagName) || !!el.querySelector('br');
}

/**
 * 空行规范 on the finished tree: no blank line between two pieces of text,
 * never two blank lines in a row, and one blank line at the very start and end.
 * The title unit keeps the template's own spacing (大标题按照模板).
 */
function normalizeBlanks(wrapper: HNode, ours: Set<string>, title: HNode[], rules: TypesetRules) {
  const inside = (el: HNode, boxes: HNode[]) => { for (let n: HNode | null = el; n; n = n.parentNode as HNode | null) if (boxes.includes(n)) return true; return false; };
  const textOnly = (el: HNode) => !!visibleText(el) && !el.querySelectorAll('img').some(i => ours.has(i.getAttribute('src') ?? ''));
  const spacers: HNode[] = [];
  const walk = (n: HNode) => { for (const c of elements(n)) { if (isSpacer(c)) spacers.push(c); else walk(c); } };
  walk(wrapper);
  for (const s of spacers) {
    if (inside(s, title)) continue;
    const sibs = elements(s.parentNode as HNode);
    const i = sibs.indexOf(s);
    const prev = sibs[i - 1], next = sibs[i + 1];
    if (prev && isSpacer(prev)) { s.remove(); continue; }
    if (prev && next && !title.includes(prev) && textOnly(prev) && textOnly(next)) s.remove();
  }
  if (rules.blankAtEdges) {
    const blank = blankLineHtml(rules);
    const kids = elements(wrapper);
    if (kids.length && !isSpacer(kids[0])) wrapper.insertAdjacentHTML('afterbegin', blank);
    if (kids.length && !isSpacer(kids.at(-1)!)) wrapper.insertAdjacentHTML('beforeend', blank);
  }
}

const norm = (s: string) => s.replace(ZWS, '').replace(/&[a-z]+;/g, '');

export function executePlan(html: string, manuscript: Manuscript, plan: PlanEntry[], options: FillOptions = {}): { html: string; report: FillReport } {
  const rules = options.rules ?? DEFAULT_RULES;
  const resolve = options.resolveImage ?? ((ref: string) => ref);
  const { root, units } = discoverUnits(html);
  const schema = schemaOf(units);
  const pristine = units.map(u => u.toString());
  const pieces = manuscriptPieces(manuscript, rules);
  const byId = new Map(pieces.map(x => [x.id, x]));
  const report: FillReport = { title: false, subtitle: false, paragraphs: 0, images: 0, removedUnits: 0, clonedUnits: 0, spilled: 0, generated: [], plan: options.planSource ?? 'auto', warnings: [] };

  const placed = new Map<string, HNode>();
  /** Manuscript pictures in the output (by src), as opposed to template ornaments. */
  const ours = new Set<string>();
  const usedOriginal = new Set<number>();
  type Instance = { node: HNode; info: UnitInfo; hasImage: boolean; hasText: boolean };
  const instances: Instance[] = [];
  let lastOriginal = -1;
  let cursor: HNode | null = null;
  let counter = 0;

  const insertAfter = (anchor: HNode, markup: string): HNode => {
    const parent = anchor.parentNode as HNode;
    const at = parent.childNodes.indexOf(anchor);
    const fresh = elements(parse(markup, { comment: false }))[0];
    parent.childNodes.splice(at + 1, 0, fresh);
    fresh.parentNode = parent;
    return fresh;
  };
  /** Decoration directly before unit `u` (dividers, number badges) in its container. */
  const leadingDecor = (u: number): number[] => {
    const out: number[] = [];
    for (let i = u - 1; i >= 0 && schema.units[i].kind === 'decor' && units[i].parentNode === units[u].parentNode; i--) out.unshift(i);
    return out;
  };
  const numberBadges = (node: HNode) => {
    for (const z of textZones(node)) if (z.len <= NUM_ZONE) setLine(z, String(counter).padStart(2, '0'));
  };

  for (const entry of plan) {
    const info = schema.units[entry.u];
    if (!info || info.kind === 'decor') continue;
    // Claim the pieces first: unknown or repeated ids are ignored here and spilled later.
    const textAssign = new Map<number, Piece[] | string>();
    for (const [key, value] of Object.entries(entry.t ?? {})) {
      const zi = Number(key);
      if (zi >= info.zones.length) continue;
      if (typeof value === 'string') { textAssign.set(zi, value); continue; }
      const list = value.map(id => byId.get(id)).filter((x): x is Piece => !!x && x.kind !== 'image' && !placed.has(x.id) && ![...textAssign.values()].some(v => Array.isArray(v) && v.includes(x)));
      if (list.length) textAssign.set(zi, list);
    }
    const images = (entry.img ?? []).map(id => byId.get(id)).filter((x): x is Piece => !!x && x.kind === 'image' && !placed.has(x.id)).slice(0, info.photos);
    const resolved = images.map(x => ({ id: x.id, url: resolve(x.ref!) })).filter((x): x is { id: string; url: string } => !!x.url);
    const urls = resolved.map(x => x.url), imageIds = resolved.map(x => x.id);
    const realText = [...textAssign.values()].some(v => Array.isArray(v));
    const label = info.kind === 'heading' && [...textAssign.entries()].some(([zi, v]) => typeof v === 'string' && info.zones[zi] > NUM_ZONE);
    if (!realText && !urls.length && !label) continue;

    // Pick the node: the original the first time and in order, a clone otherwise.
    let node: HNode;
    let decor: HNode[];
    if (!usedOriginal.has(entry.u) && entry.u > lastOriginal) {
      node = units[entry.u];
      decor = leadingDecor(entry.u).map(d => units[d]);
      usedOriginal.add(entry.u);
      lastOriginal = entry.u;
    } else {
      let anchor = cursor ?? units[entry.u];
      decor = [];
      for (const d of leadingDecor(entry.u)) decor.push(anchor = insertAfter(anchor, pristine[d]));
      node = insertAfter(anchor, pristine[entry.u]);
      report.clonedUnits++;
    }
    if (info.kind === 'heading') { counter++; for (const d of decor) numberBadges(d); }
    else if (node !== units[entry.u]) for (const d of decor) for (const z of textZones(d)) dropZone(z, d);
    cursor = node;

    const zones = textZones(node);
    const used = new Set<number>();
    let hasText = false;
    for (const [zi, value] of textAssign) {
      const zone = zones[zi];
      if (!zone) continue;
      used.add(zi);
      if (typeof value === 'string') {
        const text = value.slice(0, Math.max(zone.len + 4, 4));
        setLine(zone, zone.len <= NUM_ZONE ? text.slice(0, 4) : text);
        if (zone.len > NUM_ZONE) { report.generated.push(text); conformLine(zone, node, info.kind === 'heading' ? 'heading' : 'line', rules); zone.el.setAttribute(MARK, 'L'); }
        continue;
      }
      for (const x of value) placed.set(x.id, node);
      hasText = true;
      if (value.some(x => x.kind === 'title') && (info.kind === 'title' || zone.len <= 60)) {
        // Only lines as large as the headline; a smaller tag beside it is left for the subtitle.
        const subtitleZones = new Set([...textAssign.entries()].filter(([, v]) => Array.isArray(v) && v.some(x => x.kind === 'subtitle')).map(([i]) => i));
        const head = headlineZones(zones).filter(i => !subtitleZones.has(i));
        if (!head.includes(zi)) head.unshift(zi);
        const n = setTitle(formatArticleTitle(manuscript.title, rules), head.map(i => zones[i]));
        for (const i of head.slice(0, n)) { used.add(i); if (!zones[i].bold) addCss(zones[i].el, 'font-weight:bold;'); zones[i].el.setAttribute(MARK, 'T'); }
        report.title = true;
        continue;
      }
      const short = value.length === 1 && value[0].kind !== 'para' && zone.len < BODY_ZONE;
      if (short) {
        setLine(zone, value[0].kind === 'subtitle' ? undash(value[0].text) : value[0].text);
        // The subtitle belongs to the title block (大标题按照模板): it keeps the slot's design.
        if (value[0].kind === 'subtitle') dropInheritedFont(zone.el, node);
        else conformLine(zone, node, value[0].kind === 'heading' ? 'heading' : 'line', rules);
        zone.el.setAttribute(MARK, value[0].id);
      } else setBlock(zone, node, value.map(x => x.html).join(''), rules, value.map(x => x.id).join(' '));
      if (value.some(x => x.kind === 'subtitle')) report.subtitle = true;
      report.paragraphs += value.filter(x => x.kind === 'para').length;
    }
    // Blank first, then remove: sibling labels of one box disappear together.
    const unused = zones.filter((z, i) => !used.has(i) && !(z.len <= NUM_ZONE && info.kind === 'heading'));
    for (const z of unused) for (const t of z.texts) t.rawText = '';
    for (const z of unused) dropZone(z, node);
    if (info.kind === 'heading') numberBadges(node);

    if (info.photos) {
      const n = fillPhotos(node, urls, rules);
      for (const u of urls.slice(0, n)) ours.add(u);
      for (const img of node.querySelectorAll('img')) {
        const at = urls.indexOf(img.getAttribute('src') ?? '');
        if (at >= 0) img.setAttribute(MARK, imageIds[at]);
      }
      report.images += n;
      for (const x of images) placed.set(x.id, node);
    }
    unflipContent(node);
    unfreezeHeights(node, node);
    for (const d of node.querySelectorAll('*')) if (/height\s*:\s*[\d.]+px/i.test(d.getAttribute('style') ?? '') && visibleText(d)) unfreezeHeights(d, node);
    node.setAttribute(UNIT_MARK, `u${entry.u} ${info.kind}`);
    instances.push({ node, info, hasImage: urls.length > 0, hasText });
  }

  // Drop original units the plan did not use. Decoration belongs to the content
  // unit that follows it; only art before the first and after the last content
  // unit of the template (header, footer) stays regardless.
  const keptOriginal = (i: number) => usedOriginal.has(i);
  const contentIdx = schema.units.filter(u => u.kind !== 'decor').map(u => u.index);
  const firstContent = contentIdx[0] ?? Infinity, lastContent = contentIdx.at(-1) ?? -1;
  const emptied: HNode[] = [];
  units.forEach((node, i) => {
    const info = schema.units[i];
    if (info.kind === 'decor') {
      let owner = i + 1;
      while (owner < units.length && schema.units[owner].kind === 'decor') owner++;
      if (i > firstContent && i < lastContent && !keptOriginal(owner)) { emptied.push(node.parentNode as HNode); node.remove(); return; }
      for (const z of textZones(node)) if (z.len <= NUM_ZONE && !(keptOriginal(owner) && schema.units[owner].kind === 'heading')) dropZone(z, node);
      return;
    }
    if (!keptOriginal(i)) { emptied.push(node.parentNode as HNode); node.remove(); report.removedUnits++; }
  });
  // Boxes that only held removed units would stay as empty coloured frames.
  const wrapperNode = wrapperOf(root);
  for (let box of emptied) {
    while (box && box !== wrapperNode && box.parentNode && !visibleText(box) && !box.querySelector('img')) {
      const parent = box.parentNode as HNode;
      box.remove();
      box = parent;
    }
  }

  // Anything the plan left out is set beside its neighbour in reading order.
  const wrapper = wrapperOf(root);
  const firstBody = instances.find(x => x.info.kind !== 'title' && x.info.kind !== 'subtitle')?.node;
  const titleNode = instances.find(x => x.info.kind === 'title')?.node;
  const accent = templateAccent(titleNode ?? wrapper, rules.textColor);
  // Title-block lines without a slot go right under the template's title, or
  // before the top-level box that opens the body (never inside a body card).
  const topLevel = (n: HNode | undefined) => { let x = n; while (x && x.parentNode && x.parentNode !== wrapper) x = x.parentNode as HNode; return x && x.parentNode === wrapper ? x : undefined; };
  const headAnchor: { node: HNode | null; before: boolean } = titleNode ? { node: titleNode, before: false } : { node: topLevel(firstBody) ?? null, before: true };
  const headLines: string[] = [];
  const groups: Array<{ anchor: HNode | null; before: boolean; html: string[]; hasImage: boolean }> = [];
  let previous: HNode | null = null;
  for (const piece of pieces) {
    if (placed.has(piece.id)) { previous = placed.get(piece.id)!; continue; }
    if (piece.kind === 'title') {
      // 最前面的大标题: a template without a title slot still opens with the title, bold and large.
      if (!report.title && manuscript.title) {
        headLines.push(`<section style="padding:0 ${rules.sidePadding}px;"><p ${MARK}="T" style="margin:0;text-align:center;font-size:${rules.headingSize + 8}px;font-weight:bold;line-height:1.6;letter-spacing:${rules.letterSpacing}px;color:${accent};">${escapeHtml(formatArticleTitle(manuscript.title, rules))}</p></section>`);
        report.title = true;
      }
      continue;
    }
    if (piece.kind === 'subtitle') {
      // No slot: an outlined pill in the template's colour, the way shop title blocks set it.
      headLines.push(`<section style="padding:0 ${rules.sidePadding}px;text-align:center;"><section style="display:inline-block;max-width:100%;box-sizing:border-box;border:1px solid ${accent};border-radius:999px;padding:0 18px;"><p ${MARK}="S" style="margin:0;font-size:${rules.bodySize + 1}px;font-weight:bold;line-height:${rules.lineHeight};letter-spacing:${rules.letterSpacing}px;color:${accent};">${escapeHtml(undash(piece.text))}</p></section></section>`);
      report.subtitle = true;
      continue;
    }
    let markup = '';
    if (piece.kind === 'image') {
      const src = resolve(piece.ref!);
      if (!src) { report.warnings.push('有图片无法解析，已跳过。'); continue; }
      markup = `<p style="margin:0;text-align:center;"><img ${MARK}="${piece.id}" src="${escapeHtml(src)}" style="${imageCss(rules)}"></p>`;
      ours.add(src);
      report.images++;
    } else {
      markup = `<section ${MARK}="${piece.id}" style="padding:0 ${rules.sidePadding}px;">${piece.html}</section>`;
      if (piece.kind === 'para') report.paragraphs++;
    }
    report.spilled++;
    const anchor = previous ?? firstBody ?? null;
    const last = groups.at(-1);
    if (last && last.anchor === anchor && last.before === !previous) { last.html.push(markup); last.hasImage ||= piece.kind === 'image'; }
    else groups.push({ anchor, before: !previous, html: [markup], hasImage: piece.kind === 'image' });
  }
  const blank = blankLineHtml(rules);
  for (const g of groups) {
    const markup = g.html.map((h, i) => (rules.blankAroundImages && i > 0 && (/<img/.test(h) || /<img/.test(g.html[i - 1])) ? blank : '') + h).join('');
    const padded = rules.blankAroundImages && g.hasImage ? `${blank}${markup}${blank}` : markup;
    if (!g.anchor) wrapper.insertAdjacentHTML('beforeend', padded);
    else g.anchor.insertAdjacentHTML(g.before ? 'beforebegin' : 'afterend', padded);
  }
  if (headLines.length) {
    // A blank line separates the title block from the body that follows (空行规范 below keeps it single).
    const markup = `<section data-kiumi-head="1">${headLines.join('')}</section>` + (rules.blankAtEdges || rules.blankAroundImages ? blank : '');
    if (!headAnchor.node) wrapper.insertAdjacentHTML('afterbegin', markup);
    else headAnchor.node.insertAdjacentHTML(headAnchor.before ? 'beforebegin' : 'afterend', markup);
  }

  // Blank lines around pictures where the template itself has no spacer between.
  // Units nest differently in every template (a photo and its text can sit in
  // separate wrappers inside one card), so this works on reading order in the
  // final tree: whatever directly precedes or follows a picture block.
  if (rules.blankAroundImages) {
    const isOurs = (img: HNode) => ours.has(img.getAttribute('src') ?? '');
    const content = (el: HNode) => !!visibleText(el) || (el.tagName?.toLowerCase() === 'img' ? isOurs(el) : el.querySelectorAll('img').some(isOurs));
    const neighbour = (node: HNode, dir: -1 | 1): HNode | null => {
      for (let n: HNode = node; n !== wrapper && n.parentNode; n = n.parentNode as HNode) {
        const sibs = elements(n.parentNode as HNode);
        const s = sibs[sibs.indexOf(n) + dir];
        if (s) return s;
      }
      return null;
    };
    for (const img of root.querySelectorAll('img').filter(isOurs)) {
      // The picture block: the largest ancestor that holds no text (a photo row stays one block).
      let block: HNode = img;
      while (block.parentNode && block.parentNode !== wrapper && !visibleText(block.parentNode as HNode)) block = block.parentNode as HNode;
      const before = neighbour(block, -1);
      if (before && content(before)) before.insertAdjacentHTML('afterend', blank);
      const after = neighbour(block, 1);
      if (after && content(after)) after.insertAdjacentHTML('beforebegin', blank);
    }
  }
  const head = root.querySelector('[data-kiumi-head]') ?? undefined;
  normalizeBlanks(wrapper, ours, [titleNode, head].filter((x): x is HNode => !!x), rules);
  head?.removeAttribute('data-kiumi-head');

  // Last line of defence: every paragraph and picture must be in the output.
  let out = root.toString();
  const seen = norm(plain(out));
  const missing = pieces.filter(x => x.kind !== 'title' && (x.kind === 'image' ? !out.includes(escapeHtml(resolve(x.ref!) ?? '\u0000')) : !seen.includes(norm(x.kind === 'subtitle' ? undash(x.text) : x.text).slice(0, 12))));
  if (missing.length) {
    const tail = missing.map(x => x.kind === 'image' ? (resolve(x.ref!) ? `<p style="margin:0;text-align:center;"><img ${MARK}="${x.id}" src="${escapeHtml(resolve(x.ref!)!)}" style="${imageCss(rules)}"></p>` : '') : `<section ${MARK}="${x.id}" style="padding:0 ${rules.sidePadding}px;">${x.html}</section>`).join('');
    wrapper.insertAdjacentHTML('beforeend', tail);
    report.spilled += missing.length;
    out = root.toString();
  }

  if (!schema.summary.title && manuscript.title) report.warnings.push('模板没有标题位，已在开头按模板主色排出大标题，请检查版面。');
  if (report.spilled) report.warnings.push(`有 ${report.spilled} 处内容模板放不下，已按排版规范排在相邻位置，请检查版面。`);
  if (report.generated.length) report.warnings.push(`以下小标题由 AI 根据正文拟写，请核对：${report.generated.join('、')}`);
  return { html: options.mark ? out : stripAgentMarks(out), report };
}

/** Plan quality: share of manuscript pieces the plan itself placed. */
function coverage(plan: PlanEntry[], pieces: Piece[]): number {
  const ids = new Set(plan.flatMap(e => [...Object.values(e.t ?? {}).flatMap(v => (Array.isArray(v) ? v : [])), ...(e.img ?? [])]));
  const wanted = pieces.filter(x => x.kind !== 'title');
  return wanted.length ? wanted.filter(x => ids.has(x.id)).length / wanted.length : 1;
}

/**
 * Fill a template with a manuscript. A supplied plan (model or Agent) is used
 * when it covers most of the manuscript; otherwise the deterministic plan.
 */
export function fillTemplate(html: string, manuscript: Manuscript, options: FillOptions = {}): { html: string; report: FillReport } {
  const rules = options.rules ?? DEFAULT_RULES;
  const pieces = manuscriptPieces(manuscript, rules);
  const supplied = options.plan && options.plan.length ? options.plan : null;
  if (supplied && coverage(supplied, pieces) >= 0.6) return executePlan(html, manuscript, supplied, { ...options, planSource: options.planSource ?? 'model' });
  const plan = autoPlan(analyzeTemplate(html), pieces);
  const result = executePlan(html, manuscript, plan, { ...options, planSource: 'auto' });
  if (supplied) result.report.warnings.unshift('模型给出的排版方案不完整，已改用规则排版。');
  return result;
}

// ---------------------------------------------------------------------------
// Without a template
// ---------------------------------------------------------------------------

export type Item = { type: 'text'; paras: string[] } | { type: 'figure'; images: string[] };

export function manuscriptItems(m: Manuscript, rules: TypesetRules): Item[] {
  const items: Item[] = [];
  for (const piece of manuscriptPieces(m, rules)) {
    if (piece.kind === 'title' || piece.kind === 'subtitle') continue;
    const last = items.at(-1);
    if (piece.kind === 'image') {
      if (last?.type === 'figure') last.images.push(piece.ref!);
      else items.push({ type: 'figure', images: [piece.ref!] });
    } else if (last?.type === 'text') last.paras.push(piece.html);
    else items.push({ type: 'text', paras: [piece.html] });
  }
  return items;
}

/**
 * Without a style template: title, subtitle, then text and pictures in source
 * order, typeset by the house rules. One HTML string per block.
 */
export function plainArticle(m: Manuscript, rules: TypesetRules = DEFAULT_RULES, resolve: (ref: string) => string | null = r => r): string[] {
  const blocks: string[] = [];
  const blank = blankLineHtml(rules);
  const title = formatArticleTitle(m.title, rules);
  blocks.push(`<p style="margin:0;padding:0 ${rules.sidePadding}px;text-align:center;font-size:${rules.headingSize + 8}px;font-weight:bold;line-height:1.6;letter-spacing:${rules.letterSpacing}px;color:${rules.textColor};">${escapeHtml(title)}</p>`);
  if (m.subtitle) blocks.push(`<p style="margin:0;padding:0 ${rules.sidePadding}px;text-align:center;font-size:${rules.bodySize}px;line-height:${rules.lineHeight};color:${rules.textColor};">${escapeHtml(m.subtitle)}</p>`);
  if (rules.blankAtEdges) blocks.push(blank);
  const items = manuscriptItems(m, rules);
  items.forEach((item, i) => {
    if (item.type === 'text') blocks.push(`<section style="padding:0 ${rules.sidePadding}px;">${item.paras.join('')}</section>`);
    else for (const ref of item.images) {
      const src = resolve(ref);
      if (src) blocks.push(`<p style="margin:0;text-align:center;"><img src="${escapeHtml(src)}" style="${imageCss(rules)}"></p>`);
    }
    const next = items[i + 1];
    if (rules.blankAroundImages && next && (item.type === 'figure' || next.type === 'figure')) blocks.push(blank);
  });
  if (rules.blankAtEdges) blocks.push(blank);
  return blocks;
}
