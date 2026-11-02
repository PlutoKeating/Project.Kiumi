/**
 * Manuscript semantic model.
 *
 * Word, Markdown and clipboard imports are first reduced to a flat list of
 * `SourceFact`s (one per source paragraph, with the formatting signals that
 * survive extraction). `classifyFacts` assigns each a role with a confidence,
 * `assembleManuscript` folds the result into a tree that template filling,
 * the editor and the MCP tools all share.
 *
 * Everything here is pure and DOM-free so it runs in the browser, the Worker
 * and Node tests.
 */

export type ParaRole =
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'body'
  | 'byline'
  | 'caption'
  | 'figure'
  | 'table'
  | 'list'
  | 'quote';

export interface SourceFact {
  /** Position in the source, stable across classification. */
  i: number;
  kind: 'text' | 'image' | 'table' | 'list';
  text: string;
  html: string;
  bold?: boolean;
  /** Effective font size in px when known. */
  size?: number;
  align?: 'left' | 'center' | 'right';
  /** 1-based outline level from a real Word heading style. */
  outline?: number;
  /** Visible numbering prefix that came from Word auto-numbering. */
  numbering?: string;
  /** Image references (opaque ids resolved by the importer). */
  images?: string[];
}

export interface Classified {
  role: ParaRole;
  /** 1..3 for headings. */
  level?: 1 | 2 | 3;
  /** 0..1. Below `CONFIDENT` the item is worth a second opinion. */
  confidence: number;
}

export const CONFIDENT = 0.75;

export type Part =
  | { type: 'p'; html: string; text: string; src: number }
  | { type: 'figure'; images: string[]; caption?: string; src: number }
  | { type: 'table'; html: string; src: number }
  | { type: 'list'; html: string; src: number }
  | { type: 'quote'; html: string; text: string; src: number };

export interface Section {
  level: 1 | 2 | 3;
  heading?: string;
  /** Source index of the heading paragraph. */
  src?: number;
  parts: Part[];
}

export interface Byline {
  text: string;
  writer?: string;
  photographer?: string;
  editor?: string;
}

export interface Manuscript {
  version: 1;
  title: string;
  subtitle?: string;
  byline?: Byline;
  sections: Section[];
}

const CN_NUM = '一二三四五六七八九十百零〇两';
const TERMINAL = /[。！？!?；;…]$/;

const BYLINE_KEY = '文字|文|图片|图|摄影|摄|编辑|责编|审核|一审|二审|三审|校对|排版|供稿|通讯员|记者';
const BYLINE_START = new RegExp(`^(?:${BYLINE_KEY})\\s*[:：]\\s*\\S`);
const BYLINE_TRAILING = new RegExp(`(?:^|[。！？!?”"）)\\s])((?:${BYLINE_KEY})\\s*[:：]\\s*[^：:。！？\\n]{1,40}(?:\\s+(?:${BYLINE_KEY})\\s*[:：]\\s*[^：:。！？\\n]{1,40})*)\\s*$`);

const stripHtml = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const clean = (text: string) => text.replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();

/** Heading numbering ladder, higher rank = shallower heading. */
const LADDER: Array<[RegExp, string]> = [
  [new RegExp(`^第[${CN_NUM}\\d]+[章篇部分]`), 'chapter'],
  [new RegExp(`^[${CN_NUM}]+\\s*[、．.]`), 'cn1'],
  [new RegExp(`^第[${CN_NUM}\\d]+[节条]`), 'section'],
  [new RegExp(`^[（(][${CN_NUM}]+[）)]`), 'cn2'],
  [/^\d{1,2}\s*[、．.](?!\d)\s*\S/, 'num1'],
  [/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?\s+\S/, 'dec'],
  [/^[（(]\d{1,2}[）)]/, 'num2'],
  [/^[①②③④⑤⑥⑦⑧⑨⑩]/, 'circle'],
];

export function numberingKind(text: string): string | null {
  for (const [pattern, kind] of LADDER) if (pattern.test(text)) return kind;
  return null;
}

export interface BylineSplit {
  body: string;
  byline: string;
}

/** `……力量。文：梁锦淇 图：李文筑` -> body + byline. */
export function splitTrailingByline(text: string): BylineSplit | null {
  const flat = clean(text);
  const match = BYLINE_TRAILING.exec(flat);
  if (!match) return null;
  const byline = match[1].trim();
  const body = flat.slice(0, flat.lastIndexOf(byline)).trim();
  return { body, byline };
}

export function parseByline(text: string): Byline {
  const byline: Byline = { text: clean(text) };
  const pair = /(文字|文|图片|图|摄影|摄|编辑|责编|审核|一审|二审|三审|校对|排版|供稿|通讯员|记者)\s*[:：]\s*([^\s：:]+(?:\s+(?![^\s：:]+\s*[:：])[^\s：:]+)*)/g;
  for (const m of byline.text.matchAll(pair)) {
    const who = m[2].trim();
    if (/^(文字?|记者|通讯员|供稿)$/.test(m[1])) byline.writer = byline.writer ?? who;
    else if (/^(图片?|摄影?|摄)$/.test(m[1])) byline.photographer = byline.photographer ?? who;
    else if (/^(编辑|责编|审核|一审|二审|三审|校对|排版)$/.test(m[1])) byline.editor = byline.editor ?? who;
  }
  return byline;
}

const isShort = (text: string, max: number) => text.length > 0 && text.length <= max;

/**
 * Deterministic role assignment. Returns one entry per fact. Entries with
 * `confidence < CONFIDENT` are the only ones an LLM needs to look at.
 */
export function classifyFacts(facts: SourceFact[]): Classified[] {
  const out: Classified[] = facts.map(() => ({ role: 'body', confidence: 0.9 }));
  const texts = facts.map(f => clean(f.kind === 'text' ? f.text || stripHtml(f.html) : ''));

  // Dominant body size, used to judge "larger than body".
  const sizes = facts.filter((f, i) => f.kind === 'text' && f.size && texts[i].length > 40).map(f => f.size!);
  const bodySize = sizes.length ? sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : 0;

  facts.forEach((fact, i) => {
    if (fact.kind === 'image') out[i] = { role: 'figure', confidence: 1 };
    else if (fact.kind === 'table') out[i] = { role: 'table', confidence: 1 };
    else if (fact.kind === 'list') out[i] = { role: 'list', confidence: 1 };
  });

  const textIdx = facts.map((f, i) => (f.kind === 'text' && texts[i] ? i : -1)).filter(i => i >= 0);

  // Byline paragraphs (whole paragraph is a byline).
  for (const i of textIdx) if (BYLINE_START.test(texts[i]) && texts[i].length <= 60 && !TERMINAL.test(texts[i])) out[i] = { role: 'byline', confidence: 0.95 };

  // Title: first text paragraph near the top.
  const firstText = textIdx.find(i => out[i].role === 'body');
  const looksLikeTitle = (i: number) => {
    const f = facts[i], t = texts[i];
    if (!isShort(t, 50) || TERMINAL.test(t)) return 0;
    let score = 0.55;
    if (f.outline === 1) score = 0.95;
    if (f.align === 'center') score += 0.2;
    if (f.bold) score += 0.1;
    if (bodySize && f.size && f.size > bodySize + 1) score += 0.15;
    if (i === textIdx[0]) score += 0.1;
    return Math.min(score, 0.98);
  };
  if (firstText !== undefined && textIdx.indexOf(firstText) <= 2) {
    const score = looksLikeTitle(firstText);
    if (score >= 0.5) out[firstText] = { role: 'title', confidence: score };
  }
  const titleAt = out.findIndex(c => c.role === 'title');

  // Subtitle: right after the title, dash-led or shorter centered line.
  if (titleAt >= 0) {
    const next = textIdx.find(i => i > titleAt);
    if (next !== undefined && out[next].role === 'body') {
      const t = texts[next];
      if (/^[—–－-]{1,2}\s*\S/.test(t) && isShort(t, 60)) out[next] = { role: 'subtitle', confidence: 0.95 };
      else if (isShort(t, 40) && !TERMINAL.test(t) && facts[next].align === 'center' && !numberingKind(t)) out[next] = { role: 'subtitle', confidence: 0.6 };
    }
  }

  // Headings.
  const ladderRank = new Map<string, number>();
  for (const i of textIdx) {
    if (out[i].role !== 'body') continue;
    const fact = facts[i], text = texts[i];
    const numbered = numberingKind(fact.numbering ? `${fact.numbering} ${text}` : text);
    if (fact.outline) {
      out[i] = { role: 'heading', level: Math.min(fact.outline, 3) as 1 | 2 | 3, confidence: 0.97 };
      continue;
    }
    if (!isShort(text, 40) || TERMINAL.test(text)) continue;
    const emphasised = !!fact.bold || (!!bodySize && !!fact.size && fact.size > bodySize + 1) || fact.align === 'center';
    if (numbered) {
      if (!ladderRank.has(numbered)) ladderRank.set(numbered, ladderRank.size + 1);
      out[i] = { role: 'heading', level: Math.min(ladderRank.get(numbered)!, 3) as 1 | 2 | 3, confidence: emphasised ? 0.9 : text.length <= 20 ? 0.8 : 0.6 };
    } else if (emphasised && text.length <= 30 && i !== titleAt) {
      out[i] = { role: 'heading', level: 1, confidence: fact.bold && bodySize && fact.size && fact.size > bodySize ? 0.8 : 0.55 };
    }
  }

  // Captions: short unpunctuated centered line directly under a figure.
  facts.forEach((fact, i) => {
    if (fact.kind !== 'image') return;
    const next = i + 1;
    if (next < facts.length && facts[next].kind === 'text' && out[next].role === 'body') {
      const t = texts[next];
      if (isShort(t, 40) && !TERMINAL.test(t) && (facts[next].align === 'center' || /^图\s*\d*[:：.]/.test(t))) out[next] = { role: 'caption', confidence: facts[next].align === 'center' ? 0.7 : 0.85 };
    }
  });

  // Quotes: Word's quote style is not extracted; leave as body.
  return out;
}

/**
 * Compact input for an LLM second opinion. Only uncertain paragraphs plus a
 * little context are included, one tab-less line each, so a whole article costs
 * a few hundred tokens instead of the full text.
 *
 * Line format: `i|flags|len|first-N-chars`
 *   flags: B bold, C centered, L large, N numbered, H word-heading
 */
export function annotationRequest(facts: SourceFact[], classified: Classified[], opts: { clip?: number } = {}) {
  const clip = opts.clip ?? 24;
  const rows: string[] = [];
  const ask: number[] = [];
  const bodySizes = facts.filter(f => f.kind === 'text' && f.size).map(f => f.size!).sort((a, b) => a - b);
  const bodySize = bodySizes.length ? bodySizes[Math.floor(bodySizes.length / 2)] : 0;
  classified.forEach((c, i) => {
    const f = facts[i];
    if (f.kind !== 'text') return;
    const text = clean(f.text || stripHtml(f.html));
    if (!text) return;
    const uncertain = c.confidence < CONFIDENT;
    // Short unpunctuated body lines are the ones models fix; long prose never needs a vote.
    const plausible = uncertain || (c.role === 'body' && text.length <= 40 && !TERMINAL.test(text));
    if (!plausible) return;
    const flags = (f.bold ? 'B' : '') + (f.align === 'center' ? 'C' : '') + (bodySize && f.size && f.size > bodySize ? 'L' : '') + (numberingKind(text) ? 'N' : '') + (f.outline ? 'H' : '');
    rows.push(`${i}|${flags}|${text.length}|${text.slice(0, clip)}`);
    ask.push(i);
  });
  return {
    ask,
    prompt: rows.length
      ? '为下列段落判定角色。输入行格式 序号|标记|字数|开头。标记 B加粗 C居中 L大字 N带编号 H标题样式。\n' +
        '角色: t主标题 s副标题 h1/h2/h3 标题层级 b正文 y署名 c图注。只输出 JSON 数组，元素为 [序号,角色]，只列需要改动的。\n' +
        rows.join('\n')
      : '',
  };
}

const ROLE_CODE: Record<string, { role: ParaRole; level?: 1 | 2 | 3 }> = {
  t: { role: 'title' },
  s: { role: 'subtitle' },
  h1: { role: 'heading', level: 1 },
  h2: { role: 'heading', level: 2 },
  h3: { role: 'heading', level: 3 },
  b: { role: 'body' },
  y: { role: 'byline' },
  c: { role: 'caption' },
};

/** Apply `[[index, code], …]` patches from an LLM or an Agent. Unknown entries are ignored. */
export function applyAnnotations(classified: Classified[], patches: unknown): Classified[] {
  const next = classified.map(c => ({ ...c }));
  if (!Array.isArray(patches)) return next;
  for (const entry of patches) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const index = Number(entry[0]);
    const code = ROLE_CODE[String(entry[1])];
    if (!Number.isInteger(index) || !next[index] || !code) continue;
    if (['figure', 'table', 'list'].includes(next[index].role)) continue;
    if (code.role === 'title') for (const c of next) if (c.role === 'title') c.role = 'body';
    next[index] = { role: code.role, level: code.level, confidence: 1 };
  }
  return next;
}

/** Fold classified facts into the manuscript tree, preserving source order. */
export function assembleManuscript(facts: SourceFact[], classified: Classified[], fallbackTitle = '未命名稿件'): Manuscript {
  const manuscript: Manuscript = { version: 1, title: fallbackTitle, sections: [] };
  let current: Section = { level: 1, parts: [] };
  const sections: Section[] = [current];
  let lastFigure: Extract<Part, { type: 'figure' }> | undefined;

  const push = (part: Part) => { current.parts.push(part); lastFigure = part.type === 'figure' ? part : undefined; };

  facts.forEach((fact, i) => {
    const c = classified[i];
    const text = clean(fact.kind === 'text' ? fact.text || stripHtml(fact.html) : '');
    switch (c.role) {
      case 'title':
        manuscript.title = text;
        return;
      case 'subtitle':
        manuscript.subtitle = text.replace(/^[—–－-]{1,2}\s*/, '——');
        return;
      case 'byline': {
        manuscript.byline = parseByline(text);
        return;
      }
      case 'heading': {
        current = { level: c.level ?? 1, heading: fact.numbering ? `${fact.numbering} ${text}` : text, src: i, parts: [] };
        sections.push(current);
        lastFigure = undefined;
        return;
      }
      case 'figure':
        push({ type: 'figure', images: fact.images ?? [], src: i });
        return;
      case 'caption':
        if (lastFigure) lastFigure.caption = text;
        else push({ type: 'p', html: fact.html, text, src: i });
        return;
      case 'table':
        push({ type: 'table', html: fact.html, src: i });
        return;
      case 'list':
        push({ type: 'list', html: fact.html, src: i });
        return;
      case 'quote':
        push({ type: 'quote', html: fact.html, text, src: i });
        return;
      default: {
        if (!text && !fact.images?.length) return;
        // A trailing "文：… 图：…" glued to the last paragraph becomes the byline.
        const split = fact.kind === 'text' ? splitTrailingByline(text) : null;
        if (split && !manuscript.byline) {
          manuscript.byline = parseByline(split.byline);
          if (split.body) push({ type: 'p', html: `<p>${escapeHtml(split.body)}</p>`, text: split.body, src: i });
          return;
        }
        if (fact.images?.length) {
          // Inline images inside a text paragraph surface as their own figure so order is kept;
          // the paragraph keeps only its words.
          push({ type: 'figure', images: fact.images, src: i });
          if (text) push({ type: 'p', html: fact.html.replace(/<img\b[^>]*>/gi, ''), text, src: i });
          return;
        }
        push({ type: 'p', html: fact.html, text, src: i });
      }
    }
  });

  manuscript.sections = sections.filter(s => s.heading !== undefined || s.parts.length);
  return manuscript;
}

export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** All image references in document order. */
export function manuscriptImages(m: Manuscript): string[] {
  return m.sections.flatMap(s => s.parts.flatMap(p => (p.type === 'figure' ? p.images : [])));
}

/** Token-light outline an Agent can read before deciding what to edit. */
export function outlineOf(m: Manuscript): string[] {
  const lines = [`# ${m.title}`];
  if (m.subtitle) lines.push(`## ${m.subtitle}`);
  if (m.byline) lines.push(`署名: ${m.byline.text}`);
  m.sections.forEach((s, i) => {
    const figures = s.parts.filter(p => p.type === 'figure').reduce((n, p) => n + (p as { images: string[] }).images.length, 0);
    lines.push(`${i}|h${s.level}|${s.heading ?? '(无标题前言)'}|段${s.parts.filter(p => p.type === 'p').length}|图${figures}`);
  });
  return lines;
}
