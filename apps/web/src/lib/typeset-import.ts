import { analyzeTemplate, assembleManuscript, classifyFacts, fillTemplate, formatArticleTitle, manuscriptPieces, parsePlan, planPrompt, reviewPlan, reviewPrompt, sanitizeHtml, applyAnnotations, annotationRequest, outlineOf, type Classified, type FillReport, type Manuscript, type PlanEntry, type SourceFact, type TypesetRules } from '@kiumi/core';
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
 * Ask the server model to review every paragraph's role (rules give the
 * starting point). Fails closed: any error leaves the rule-based result.
 */
export async function annotate(facts: SourceFact[], classified: Classified[], session?: string): Promise<unknown | undefined> {
  const { prompt, ask } = annotationRequest(facts, classified, { all: true });
  if (!ask.length) return undefined;
  try {
    const result = await api.request<{ patches: unknown }>('/api/manuscript/annotate', { method: 'POST', body: JSON.stringify({ prompt, session }) });
    return result.patches;
  } catch { return undefined; }
}

export interface StyledResult {
  preview: ImportPreview;
  report: FillReport;
  manuscript: Manuscript;
  /** model: a reviewed model plan was used; unavailable: no model answered; rejected: the model's plans failed review. */
  planStatus: PlanStatus;
  /** What the layout review loop works from: the sanitized template, the plan used, and how images resolve. */
  template: string;
  plan: PlanEntry[] | null;
  resolveImage: (ref: string) => string | null;
  /** Paragraph list for structure fixes during review, and how to apply them on top of the import's patches. */
  structure: { prompt: string; apply: (patches: Array<[number, string]>) => Manuscript };
}

/** Review rounds a model plan gets after the first answer before falling back to the rule plan. */
export const PLAN_REVIEW_ROUNDS = 2;

/**
 * Ask the server model how to lay the manuscript out in the template. Every
 * answer goes through the mandatory review (`reviewPlan`); a plan with errors
 * is sent back with its problems for another round. No plan when no model
 * answers or no round produces a clean plan, so the rule plan is used instead.
 */
export type PlanStatus = 'model' | 'unavailable' | 'rejected';

export async function requestPlan(templateHtml: string, manuscript: Manuscript, rules: TypesetRules, session?: string): Promise<{ plan: PlanEntry[] | null; status: PlanStatus }> {
  const schema = analyzeTemplate(templateHtml);
  const pieces = manuscriptPieces(manuscript, rules);
  const base = planPrompt(schema, pieces);
  let prompt = base;
  for (let round = 0; round <= PLAN_REVIEW_ROUNDS; round++) {
    let plan: PlanEntry[] | null;
    try {
      const result = await api.request<{ entries: unknown }>('/api/manuscript/plan', { method: 'POST', body: JSON.stringify({ prompt, session }) });
      plan = parsePlan(result.entries);
    } catch { return { plan: null, status: round ? 'rejected' : 'unavailable' }; }
    if (!plan) return { plan: null, status: round ? 'rejected' : 'unavailable' };
    const errors = reviewPlan(schema, pieces, plan).filter(x => x.level === 'error');
    if (!errors.length) return { plan, status: 'model' };
    prompt = reviewPrompt(base, plan, errors);
  }
  return { plan: null, status: 'rejected' };
}

/** Pour the recognized manuscript into a chosen style template, planned by the model when it answers in time. */
/** One id per import: its model calls share a gateway session (routing and prompt caching). */
export const importSession = () => crypto.randomUUID().replace(/-/g, '');

export async function typesetPreview(preview: ImportPreview, atomTplId: string, rules: TypesetRules, patches?: unknown, options: { planTimeoutMs?: number; session?: string } = {}): Promise<StyledResult> {
  const record = await api.fetchTemplate(atomTplId);
  const { manuscript } = recognize(preview, patches);
  const replacements = preview.replacements ?? {};
  const template = sanitizeHtml(record.html);
  const asked = await Promise.race([requestPlan(template, manuscript, rules, options.session), new Promise<{ plan: null; status: PlanStatus }>(resolve => setTimeout(() => resolve({ plan: null, status: 'unavailable' }), options.planTimeoutMs ?? 60_000))]);
  const resolveImage = (ref: string) => replacements[ref] ?? ref;
  const { html, report } = fillTemplate(template, manuscript, { rules, plan: asked.plan, planSource: 'model', resolveImage });
  if (asked.status === 'rejected') report.warnings.unshift(`模型的排版方案经 ${PLAN_REVIEW_ROUNDS + 1} 轮复核仍不合格，已改用规则排版。`);
  const styled: ImportPreview = {
    ...preview,
    title: formatArticleTitle(manuscript.title || preview.title || '', rules),
    preserveLayout: true,
    items: [{ label: '风格排版稿件', block: { kind: 'library', id: `blk-${Date.now().toString(36)}`, tplId: record.atomTplId, matrix: [], html } }],
    issues: [...preview.issues, ...report.warnings.map(message => ({ location: report.plan === 'model' ? 'AI 排版' : '风格排版', message }))],
  };
  const recognized = recognize(preview, patches);
  const base = Array.isArray(patches) ? patches : [];
  const structure = {
    prompt: annotationRequest(recognized.facts, recognized.classified, { all: true }).prompt,
    apply: (more: Array<[number, string]>) => recognize(preview, [...base, ...more]).manuscript,
  };
  return { preview: styled, report, manuscript, planStatus: report.plan === 'model' ? 'model' : asked.status === 'model' ? 'rejected' : asked.status, template, plan: report.plan === 'model' ? asked.plan : null, resolveImage, structure };
}
