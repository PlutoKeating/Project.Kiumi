import { parse, type HTMLElement as HNode } from 'node-html-parser';
import { assembleManuscript, escapeHtml, type Manuscript, type Part } from './manuscript.ts';
import {
  DEFAULT_RULES,
  blankLineHtml,
  formatArticleTitle,
  imageCss,
  paragraphCss,
  type TypesetRules,
} from './typeset.ts';

/**
 * Fill a recorded template (one article skeleton made of top-level units) with a
 * manuscript. Text in shop templates is a placeholder whose length equals the
 * original copy, so roles come from style and footprint, not from wording.
 */

export type UnitKind = 'title' | 'subtitle' | 'text' | 'photo' | 'mixed' | 'decor';

export interface UnitInfo {
  index: number;
  kind: UnitKind;
  /** Placeholder characters per text zone. */
  zones: number[];
  /** Photo-sized <img> slots in the unit. */
  photos: number;
  /** Effective font size of the largest zone (px). */
  size: number;
  bold: boolean;
  /** Mixed units: true when the pictures sit above the text. */
  photoFirst?: boolean;
}

export interface TemplateSchema {
  version: 1;
  units: UnitInfo[];
  /** Counts a caller can show or an Agent can reason about. */
  summary: { text: number; photo: number; mixed: number; title: boolean; subtitle: boolean };
}

const SKIP = /^(script|style|svg)$/i;
const ZWS = /[​‌‍﻿ \s]/g;

function wrapperOf(root: HNode): HNode {
  let node = root;
  for (;;) {
    const kids = node.childNodes.filter(c => c.nodeType === 1);
    if (kids.length !== 1) return node;
    node = kids[0] as HNode;
  }
}

const styleOf = (el: HNode, name: string): string | undefined => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(el.getAttribute('style') ?? '');
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
        const trimmed = raw.replace(ZWS, '');
        if (!trimmed && !raw.trim()) continue;
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
      } else if (child.nodeType === 1 && !SKIP.test(child.tagName ?? '')) visit(child);
    }
  };
  visit(unit);
  return order;
}

/** Photos are sample pictures; ornaments are small png/gif. */
export function isPhotoSrc(src: string): boolean {
  const size = /sz[-_](\d+)/.exec(src);
  const bytes = size ? Number(size[1]) : 0;
  if (/\.(jpe?g)(?:[?#]|$)/i.test(src)) return bytes === 0 || bytes >= 40_000;
  return bytes >= 120_000;
}

const photoImgs = (unit: HNode) => unit.querySelectorAll('img').filter(i => !i.closest('svg') && isPhotoSrc(i.getAttribute('src') ?? i.getAttribute('data-src') ?? ''));

function splitUnits(html: string) {
  const root = parse(html, { comment: false });
  const wrapper = wrapperOf(root);
  const units = wrapper.childNodes.filter(c => c.nodeType === 1) as HNode[];
  return { root, wrapper, units };
}

export function analyzeTemplate(html: string): TemplateSchema {
  const { units } = splitUnits(html);
  const infos: UnitInfo[] = units.map((u, index) => {
    const zones = textZones(u);
    const photos = photoImgs(u).length;
    const top = zones.slice().sort((a, b) => b.size - a.size)[0];
    const kind: UnitKind = zones.length ? (photos ? (zones.every(z => z.len <= 8) ? 'photo' : 'mixed') : 'text') : photos ? 'photo' : 'decor';
    const html = u.toString();
    const firstText = zones[0] ? html.indexOf(String(zones[0].texts[0]?.rawText ?? '').slice(0, 4)) : -1;
    return { index, kind, zones: zones.map(z => z.len), photos, size: top?.size ?? 0, bold: !!top?.bold, photoFirst: photos > 0 && (firstText < 0 || html.indexOf('<img') < firstText) };
  });
  // Title: the first text unit whose largest zone clearly exceeds body size.
  const sizes = infos.filter(i => i.kind === 'text').map(i => i.size).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 16;
  const titleAt = infos.findIndex(i => i.kind === 'text' && i.size >= Math.max(median * 1.35, 20) && Math.max(...i.zones) <= 60);
  const first = infos.findIndex(i => i.kind === 'text');
  const title = titleAt >= 0 && titleAt <= first + 1 ? titleAt : -1;
  if (title >= 0) {
    infos[title].kind = 'title';
    const after = infos.slice(title + 1).find(i => i.kind !== 'decor');
    if (after && after.kind === 'text' && after.zones.length === 1 && after.zones[0] <= 40 && after.size < infos[title].size) after.kind = 'subtitle';
  }
  return {
    version: 1,
    units: infos,
    summary: {
      text: infos.filter(i => i.kind === 'text').length,
      photo: infos.reduce((n, i) => n + (i.kind === 'photo' || i.kind === 'mixed' ? Math.max(i.photos, 1) : 0), 0),
      mixed: infos.filter(i => i.kind === 'mixed').length,
      title: title >= 0,
      subtitle: infos.some(i => i.kind === 'subtitle'),
    },
  };
}

export interface FillOptions {
  rules?: TypesetRules;
  /** Turn an image reference from the manuscript into a URL. */
  resolveImage?: (ref: string) => string | null;
  schema?: TemplateSchema;
}

export interface FillReport {
  title: boolean;
  subtitle: boolean;
  paragraphs: number;
  images: number;
  removedUnits: number;
  clonedUnits: number;
  warnings: string[];
}

type Item = { type: 'text'; paras: string[] } | { type: 'figure'; images: string[] };

function manuscriptItems(m: Manuscript, rules: TypesetRules): Item[] {
  const items: Item[] = [];
  const text = (html: string) => {
    const last = items.at(-1);
    if (last?.type === 'text') last.paras.push(html);
    else items.push({ type: 'text', paras: [html] });
  };
  const paraHtml = (part: Part): string => {
    if (part.type === 'p' || part.type === 'quote') {
      // Keep inline emphasis, drop everything else about presentation.
      const inner = part.html.replace(/^\s*<p[^>]*>/i, '').replace(/<\/p>\s*$/i, '');
      return `<p style="${paragraphCss('body', rules)}">${inner}</p>`;
    }
    return part.type === 'table' || part.type === 'list' ? part.html : '';
  };
  for (const section of m.sections) {
    if (section.heading) text(`<p style="${paragraphCss('heading', rules)}">${escapeHtml(section.heading)}</p>`);
    for (const part of section.parts) {
      if (part.type === 'figure') {
        for (const ref of part.images) {
          const last = items.at(-1);
          if (last?.type === 'figure') last.images.push(ref);
          else items.push({ type: 'figure', images: [ref] });
        }
        if (part.caption) text(`<p style="${paragraphCss('caption', rules)}">${escapeHtml(part.caption)}</p>`);
      } else {
        const html = paraHtml(part);
        if (html) text(html);
      }
    }
  }
  if (m.byline) {
    const parts = [m.byline.writer && `文：${m.byline.writer}`, m.byline.photographer && `图：${m.byline.photographer}`, m.byline.editor && `编辑：${m.byline.editor}`].filter(Boolean);
    text(`<p style="${paragraphCss('byline', rules)}">${escapeHtml(parts.length ? parts.join(' ') : m.byline.text)}</p>`);
  }
  return items;
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

function fillTextUnit(unit: HNode, paragraphs: string[], rules: TypesetRules) {
  const zones = textZones(unit);
  if (!zones.length) return false;
  const main = zones.slice().sort((a, b) => b.len - a.len)[0];
  for (const z of zones) if (z !== main) { for (const t of z.texts) t.rawText = ''; if (!z.el.querySelector('img') && z.el !== unit) z.el.remove(); }
  const html = `<section style="padding:0 ${rules.sidePadding}px;">${paragraphs.join('')}</section>`;
  if (main.el === unit) unit.set_content(html);
  else if (/^(p|h[1-6]|li)$/i.test(main.el.tagName)) main.el.replaceWith(html);
  else main.el.set_content(html);
  unfreezeHeights(unit, unit);
  return true;
}

function fillPhotoUnit(unit: HNode, urls: string[], rules: TypesetRules, keepText = false): number {
  const imgs = photoImgs(unit);
  let used = 0;
  imgs.forEach((img, i) => {
    if (i < urls.length) {
      img.setAttribute('src', urls[i]);
      img.removeAttribute('data-src');
      img.removeAttribute('srcset');
      used++;
    } else {
      const holder = img.parentNode as HNode;
      (holder && holder !== unit && holder.querySelectorAll('img').length === 1 ? holder : img).remove();
    }
  });
  if (!keepText) for (const z of textZones(unit)) for (const t of z.texts) t.rawText = '';
  if (imgs.length === 1 && urls.length >= 1) {
    const holder = imgs[0].parentNode as HNode;
    if (holder && holder !== unit) holder.setAttribute('style', `${holder.getAttribute('style') ?? ''};width:${rules.imageWidth}%;margin-left:auto;margin-right:auto;`.replace(/^;/, ''));
  }
  unfreezeHeights(unit, unit);
  return used;
}

/** Split `paras` across `anchors` text units, proportionally to their original size. */
function distribute(paras: string[], weights: number[]): string[][] {
  const n = Math.min(paras.length, weights.length);
  if (n <= 1) return [paras];
  const use = weights.slice(0, n);
  const total = use.reduce((s, w) => s + Math.max(w, 1), 0);
  const chunks: string[][] = Array.from({ length: n }, () => []);
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const share = i === n - 1 ? paras.length - cursor : Math.max(1, Math.round((paras.length * Math.max(use[i], 1)) / total));
    const take = Math.min(share, paras.length - cursor - (n - 1 - i));
    chunks[i] = paras.slice(cursor, cursor + Math.max(1, take));
    cursor += Math.max(1, take);
  }
  return chunks.filter(c => c.length);
}

export function fillTemplate(html: string, manuscript: Manuscript, options: FillOptions = {}): { html: string; report: FillReport } {
  const rules = options.rules ?? DEFAULT_RULES;
  const schema = options.schema ?? analyzeTemplate(html);
  const { wrapper, units } = splitUnits(html);
  const report: FillReport = { title: false, subtitle: false, paragraphs: 0, images: 0, removedUnits: 0, clonedUnits: 0, warnings: [] };
  const resolve = options.resolveImage ?? ((ref: string) => ref);

  // Working list of units; `keep` decides what survives.
  type Slot = { node: HNode; info: UnitInfo; keep: boolean };
  const slots: Slot[] = units.map((node, i) => ({ node, info: schema.units[i] ?? { index: i, kind: 'decor', zones: [], photos: 0, size: 0, bold: false }, keep: true }));
  const insertAfter = (slot: Slot, node: HNode, info: UnitInfo) => { slots.splice(slots.indexOf(slot) + 1, 0, { node, info, keep: true }); };

  // Title and subtitle.
  const titleSlot = slots.find(s => s.info.kind === 'title');
  if (titleSlot) {
    const zones = textZones(titleSlot.node).filter(z => z.len > 0);
    const full = formatArticleTitle(manuscript.title, rules);
    let lines = [full];
    if (zones.length >= 2 && full.includes(' ')) {
      const mid = full.length / 2;
      const cuts = [...full].map((c, i) => (c === ' ' ? i : -1)).filter(i => i >= 0).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      lines = [full.slice(0, cuts[0]).trim(), full.slice(cuts[0] + 1).trim()];
    }
    zones.forEach((z, i) => (lines[i] !== undefined ? setLine(z, lines[i]) : setLine(z, '')));
    unfreezeHeights(titleSlot.node, titleSlot.node);
    report.title = true;
  }
  const subSlot = slots.find(s => s.info.kind === 'subtitle');
  if (subSlot) {
    if (manuscript.subtitle) {
      const z = textZones(subSlot.node)[0];
      if (z) { setLine(z, manuscript.subtitle); report.subtitle = true; }
    } else { subSlot.keep = false; report.removedUnits++; }
  }

  // Body: walk manuscript items against template anchors in order. A mixed unit
  // contributes a photo part and a text part (in document order) that share one node.
  const items = manuscriptItems(manuscript, rules);
  type Part2 = { slot: Slot; kind: 'text' | 'photo' };
  const used = new Set<Slot>();
  const usedText = new Set<Slot>();
  const usedPhoto = new Set<Slot>();
  const partsOf = (): Part2[] =>
    slots.filter(s => s.keep).flatMap<Part2>(s => {
      if (s.info.kind === 'text') return [{ slot: s, kind: 'text' }];
      if (s.info.kind === 'photo') return [{ slot: s, kind: 'photo' }];
      if (s.info.kind === 'mixed') return s.info.photoFirst === false ? [{ slot: s, kind: 'text' }, { slot: s, kind: 'photo' }] : [{ slot: s, kind: 'photo' }, { slot: s, kind: 'text' }];
      return [];
    });
  let cursor: Part2 | null = null;
  const after = (): Part2[] => {
    const list = partsOf();
    if (!cursor) return list;
    const at = list.findIndex(p => p.slot === cursor!.slot && p.kind === cursor!.kind);
    return at < 0 ? list : list.slice(at + 1);
  };
  const cloneUnit = (proto: Slot, anchor: Slot | undefined): Slot => {
    const node = parse(proto.node.toString()).firstChild as HNode;
    const clone: Slot = { node, info: { ...proto.info }, keep: true };
    const idx = anchor ? slots.indexOf(anchor) : slots.indexOf(proto);
    slots.splice(idx + 1, 0, clone);
    report.clonedUnits++;
    return clone;
  };
  const lastOf = (pred: (s: Slot) => boolean) => slots.slice().reverse().find(s => s.keep && pred(s) && s.info.kind !== 'title' && s.info.kind !== 'subtitle');
  const nextOf = (kind: 'text' | 'photo') => {
    let list = after();
    let target = list.find(p => p.kind === kind);
    if (!target) {
      const proto = lastOf(s => s.info.kind === kind || s.info.kind === 'mixed');
      if (!proto) return undefined;
      cloneUnit(proto, cursor?.slot);
      list = after();
      target = list.find(p => p.kind === kind);
    }
    return target;
  };

  for (const item of items) {
    if (item.type === 'text') {
      let target = nextOf('text');
      if (!target) { report.warnings.push('模板没有可承载正文的文字单元，后续正文未填入。'); break; }
      // Collect consecutive text parts (other kinds break the segment).
      const list = after();
      const segment: Part2[] = [];
      for (let i = list.findIndex(p => p.slot === target!.slot && p.kind === target!.kind); i >= 0 && i < list.length && list[i].kind === 'text'; i++) segment.push(list[i]);
      const weights = segment.map(p => Math.max(...p.slot.info.zones, 1));
      const chunks = distribute(item.paras, weights);
      chunks.forEach((chunk, i) => { fillTextUnit(segment[i].slot.node, chunk, rules); used.add(segment[i].slot); usedText.add(segment[i].slot); report.paragraphs += chunk.length; });
      cursor = segment[Math.max(0, chunks.length - 1)];
    } else {
      let pending = item.images.map(ref => resolve(ref)).filter((u): u is string => !!u);
      if (pending.length < item.images.length) report.warnings.push(`有 ${item.images.length - pending.length} 张图片无法解析，已跳过。`);
      while (pending.length) {
        const target = nextOf('photo');
        if (!target) { report.warnings.push('模板没有图片位，图片已省略；请换一个带图片位的模板。'); pending = []; break; }
        const capacity = Math.max(target.slot.info.photos, 1);
        report.images += fillPhotoUnit(target.slot.node, pending.splice(0, capacity), rules, target.slot.info.kind === 'mixed');
        used.add(target.slot);
        usedPhoto.add(target.slot);
        cursor = target;
      }
    }
  }
  // Template content after the last item is surplus; skipped anchors in the middle are surplus too.
  for (const s of slots) {
    if (!s.keep || !['text', 'photo', 'mixed'].includes(s.info.kind)) continue;
    if (!used.has(s)) { s.keep = false; report.removedUnits++; }
    else if (s.info.kind === 'mixed') {
      // One half of a mixed unit may be unused: blank its placeholders.
      if (!usedText.has(s)) for (const z of textZones(s.node)) for (const t of z.texts) t.rawText = '';
      if (!usedPhoto.has(s)) for (const img of photoImgs(s.node)) img.remove();
    }
  }

  // Blank lines around images unless the template already spaces them.
  const out: string[] = [];
  const blank = blankLineHtml(rules);
  const kindsOut: Array<UnitKind | 'blank'> = [];
  const final = slots.filter(s => s.keep);
  final.forEach((s, i) => {
    const prev = final[i - 1];
    const needsBlank = rules.blankAroundImages && prev && (((prev.info.kind === 'photo' || prev.info.kind === 'mixed') && (s.info.kind === 'photo' || s.info.kind === 'text' || s.info.kind === 'mixed')) || (prev.info.kind === 'text' && (s.info.kind === 'photo' || s.info.kind === 'mixed')));
    if (needsBlank) { out.push(blank); kindsOut.push('blank'); }
    out.push(s.node.toString());
    kindsOut.push(s.info.kind);
  });
  if (rules.blankAtEdges && final.length) {
    const firstAnchor = final.findIndex(s => ['photo', 'text', 'mixed'].includes(s.info.kind));
    if (firstAnchor === 0) out.unshift(blank);
    const last = final.at(-1)!;
    if (['photo', 'text', 'mixed'].includes(last.info.kind)) out.push(blank);
  }
  wrapper.set_content(out.join(''));
  void imageCss;
  void assembleManuscript;
  return { html: wrapper === undefined ? '' : (wrapperRoot(wrapper) ?? ''), report };
}

function wrapperRoot(wrapper: HNode): string {
  let top: HNode = wrapper;
  while (top.parentNode) top = top.parentNode as HNode;
  return top.toString();
}
