import { assembleManuscript, classifyFacts, fillTemplate, sanitizeHtml, applyAnnotations, annotationRequest, outlineOf, type Classified, type FillReport, type Manuscript, type SourceFact, type TypesetRules } from '@kiumi/core';
import * as api from '../api.ts';
import type { ImportPreview } from './word-import/index.ts';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** Flatten preview items into the facts the structure recognizer works on. */
export function factsFromPreview(preview: ImportPreview): SourceFact[] {
  return preview.items.map((item, i): SourceFact => {
    const root = parse(item.block.html || '').body;
    const el = root.firstElementChild;
    const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
    const images = [...root.querySelectorAll('img')].map(img => img.getAttribute('src') || '').filter(Boolean);
    const hint = item.hint;
    if (item.label === '表格') return { i, kind: 'table', text, html: item.block.html || '' };
    if (item.label === '列表') return { i, kind: 'list', text, html: item.block.html || '' };
    if (!text && images.length) return { i, kind: 'image', text: '', html: item.block.html || '', images };
    const heading = el && /^H([1-6])$/.exec(el.tagName);
    return { i, kind: 'text', text, html: item.block.html || '', bold: hint?.bold, size: hint?.size, align: hint?.align, outline: heading ? Number(heading[1]) : undefined, images: images.length ? images : undefined };
  });
}

export interface Typeset {
  manuscript: Manuscript;
  facts: SourceFact[];
  classified: Classified[];
  outline: string[];
}

export function recognize(preview: ImportPreview, patches?: unknown): Typeset {
  const facts = factsFromPreview(preview);
  let classified = classifyFacts(facts);
  if (patches) classified = applyAnnotations(classified, patches);
  const manuscript = assembleManuscript(facts, classified, preview.title);
  return { manuscript, facts, classified, outline: outlineOf(manuscript) };
}

/**
 * Ask the server model about the few uncertain paragraphs. Fails closed: any
 * error simply leaves the rule-based result in place.
 */
export async function annotate(facts: SourceFact[], classified: Classified[]): Promise<unknown | undefined> {
  const { prompt, ask } = annotationRequest(facts, classified);
  if (!ask.length) return undefined;
  try {
    const result = await api.request<{ patches: unknown }>('/api/manuscript/annotate', { method: 'POST', body: JSON.stringify({ prompt }) });
    return result.patches;
  } catch { return undefined; }
}

export interface StyledResult {
  preview: ImportPreview;
  report: FillReport;
  manuscript: Manuscript;
}

/** Pour the recognized manuscript into a chosen style template. */
export async function typesetPreview(preview: ImportPreview, atomTplId: string, rules: TypesetRules, patches?: unknown): Promise<StyledResult> {
  const record = await api.fetchTemplate(atomTplId);
  const { manuscript } = recognize(preview, patches);
  const replacements = preview.replacements ?? {};
  const { html, report } = fillTemplate(sanitizeHtml(record.html), manuscript, { rules, resolveImage: ref => replacements[ref] ?? ref });
  const styled: ImportPreview = {
    ...preview,
    title: manuscript.title || preview.title,
    preserveLayout: true,
    items: [{ label: '风格排版稿件', block: { kind: 'library', id: `blk-${Date.now().toString(36)}`, tplId: record.atomTplId, matrix: [], html } }],
    issues: [...preview.issues, ...report.warnings.map(message => ({ location: '风格排版', message }))],
  };
  return { preview: styled, report, manuscript };
}
