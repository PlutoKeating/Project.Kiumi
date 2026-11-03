import {
  analyzeTemplate, applyPolish, autoPlan, executePlan, inspectElement, KEY_MARK, layoutFindings, manuscriptPieces, MARK, numberElements,
  parseAgentReply, planPrompt, reviewPlan, stripAgentMarks, UNIT_MARK, formatArticleTitle,
  type AgentAction, type LayoutFinding, type Manuscript, type PlanEntry, type TypesetRules,
} from '@kiumi/core';
import * as api from '../api.ts';

/**
 * Layout review loop (ReAct) for the importer: render the styled article at
 * phone width, measure it, screenshot it, and let the server model think and
 * take one action per step until it is satisfied (or the budget runs out).
 * Every action goes through core (`applyPolish`, `reviewPlan`), so the house
 * rules and the manuscript content are protected whatever the model asks.
 */

export const AGENT_MAX_STEPS = 20;
export const AGENT_MAX_MS = 8 * 60_000;
const WIDTH = 375;

type Part = { type: 'text'; text: string } | { type: 'image'; mime: string; data: string };
interface Message { role: 'user' | 'assistant'; content: string | Part[] }

export interface AgentStep {
  n: number;
  thought: string;
  /** Short label of the action, e.g. 「调整 #37 样式」. */
  action: string;
  outcome: 'done' | 'rejected' | 'looked' | 'finished' | 'error';
  note: string;
}

export interface AgentResult {
  html: string;
  steps: AgentStep[];
  summary: string;
  unresolved: string;
  /** satisfied: the model finished and the final check passed; others are why the loop stopped. */
  stop: 'satisfied' | 'accepted-with-issues' | 'budget' | 'cancelled' | 'unavailable' | 'failed';
  findings: LayoutFinding[];
}

export interface AgentInput {
  template: string;
  manuscript: Manuscript;
  rules: TypesetRules;
  plan: PlanEntry[] | null;
  resolveImage: (ref: string) => string | null;
  /** Structure list for fix_structure (annotationRequest with all paragraphs) and how to apply patches. */
  structure?: { prompt: string; apply: (patches: Array<[number, string]>) => Manuscript };
  session?: string;
  signal?: AbortSignal;
  onStep?: (step: AgentStep, html: string) => void;
  maxSteps?: number;
  maxMs?: number;
}

// ---------------------------------------------------------------------------
// Rendering and measuring
// ---------------------------------------------------------------------------

const FRAME_CSS = `html,body{margin:0;padding:0;background:#fff}body{width:${WIDTH}px;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;font-size:16px;line-height:1.6;color:#000;overflow-x:hidden}img{max-width:100%}`;

async function renderFrame(html: string): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;height:2000px;border:0;visibility:hidden;pointer-events:none`;
  // No scripts in template HTML (sanitized), and the frame never runs any: measuring only.
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`;
  document.body.appendChild(frame);
  await new Promise<void>(resolve => { frame.onload = () => resolve(); setTimeout(resolve, 5000); });
  const doc = frame.contentDocument!;
  await Promise.race([
    Promise.all([...doc.images].map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })))),
    new Promise(r => setTimeout(r, 6000)),
  ]);
  frame.style.height = `${Math.max(800, doc.documentElement.scrollHeight)}px`;
  await new Promise(r => requestAnimationFrame(() => r(null)));
  return { frame, doc };
}

interface Box { x: number; y: number; w: number; h: number }
const boxOf = (r: DOMRect): Box => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
const intersect = (a: Box, b: Box): Box => { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y); return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y }; };
const kOf = (el: Element) => Number(el.getAttribute(KEY_MARK)) || 0;
const marks = (el: Element) => (el.getAttribute(MARK) ?? '').split(/\s+/).filter(Boolean);
const textOf = (el: Element) => (el.textContent ?? '').replace(/[​\s]+/g, ' ').trim();

function textBox(el: Element): Box | null {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return r.width && r.height ? boxOf(r) : null;
}

interface Measured { listing: string[]; findings: LayoutFinding[]; height: number; labels: Array<{ k: number; box: Box; bad: boolean }> }

/** Geometry the markup cannot tell: clipping, overlap, overflow, orphaned title lines, gaps. */
function measure(doc: Document): Measured {
  const view = doc.defaultView!;
  const findings: LayoutFinding[] = [];
  const labels: Measured['labels'] = [];
  const contentText = [...doc.querySelectorAll(`[${MARK}]`)].filter(el => el.tagName.toLowerCase() !== 'img' && textOf(el));
  const contentImgs = [...doc.querySelectorAll<HTMLImageElement>(`img[${MARK}]`)];

  for (const el of contentText) {
    const tb = textBox(el);
    if (!tb) { findings.push({ level: 'error', k: kOf(el), message: `稿件文字 ${marks(el).join(' ')} 没有显示出来（可能被隐藏或压成 0 高）。` }); continue; }
    // Clipped by a box that hides overflow, or by an SVG foreignObject (always clips).
    for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
      const style = view.getComputedStyle(a);
      const clips = a.tagName.toLowerCase() === 'foreignobject' || /hidden|clip/.test(style.overflow + style.overflowY + style.overflowX);
      if (!clips) continue;
      const ab = boxOf(a.getBoundingClientRect());
      const over = Math.max(tb.y + tb.h - (ab.y + ab.h), ab.y - tb.y, tb.x + tb.w - (ab.x + ab.w), ab.x - tb.x);
      if (over > 2) { findings.push({ level: 'error', k: kOf(el), message: `#${kOf(el)}（${marks(el).join(' ')}）的文字被外框 #${kOf(a)} 裁掉约 ${over}px。` }); break; }
    }
    if (tb.x + tb.w > WIDTH + 2 || tb.x < -2) findings.push({ level: 'error', k: kOf(el), message: `#${kOf(el)} 的文字超出手机屏幕宽度。` });
    const size = parseFloat(view.getComputedStyle(el).fontSize);
    if (size < 12) findings.push({ level: 'warn', k: kOf(el), message: `#${kOf(el)} 字太小（${size}px）。` });
  }
  // Overlap between different pieces of text, and text over photos.
  const boxes = contentText.map(el => ({ el, box: textBox(el) })).filter((x): x is { el: Element; box: Box } => !!x.box);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const o = area(intersect(a.box, b.box));
    if (o > 0.15 * Math.min(area(a.box), area(b.box))) findings.push({ level: 'error', k: kOf(b.el), message: `#${kOf(a.el)}（${marks(a.el).join(' ')}）和 #${kOf(b.el)}（${marks(b.el).join(' ')}）的文字重叠。` });
  }
  for (const img of contentImgs) {
    const ib = boxOf(img.getBoundingClientRect());
    if (ib.w < 40 || ib.h < 30) { findings.push({ level: 'error', k: kOf(img), message: `稿件图片 ${marks(img).join(' ')}（#${kOf(img)}）几乎看不见（${ib.w}×${ib.h}）。` }); continue; }
    for (const t of boxes) if (area(intersect(ib, t.box)) > 0.1 * area(t.box)) findings.push({ level: 'error', k: kOf(t.el), message: `#${kOf(t.el)} 的文字压在稿件图片 #${kOf(img)} 上。` });
  }
  // Title lines: no single character left on the last line.
  for (const el of doc.querySelectorAll(`[${MARK}="T"]`)) {
    const range = doc.createRange(); range.selectNodeContents(el);
    const lines = [...range.getClientRects()].filter(r => r.width > 1);
    const tops = [...new Set(lines.map(r => Math.round(r.top / 4)))];
    if (tops.length > 1) {
      const last = lines.filter(r => Math.round(r.top / 4) === tops.at(-1));
      const width = last.reduce((s, r) => s + r.width, 0), size = parseFloat(view.getComputedStyle(el).fontSize) || 16;
      if (width / size < 2.5) findings.push({ level: 'warn', k: kOf(el), message: `标题 #${kOf(el)} 最后一行只剩 ${Math.max(1, Math.round(width / size))} 个字。` });
    }
  }
  // Big pictures that are not the manuscript's: art, or a sample photo the template ships (often a GIF).
  for (const img of doc.images) {
    if (img.hasAttribute(MARK) || img.closest('svg') || /\btitle\b/.test(img.closest(`[${UNIT_MARK}]`)?.getAttribute(UNIT_MARK) ?? '')) continue;
    const b = boxOf(img.getBoundingClientRect());
    if (b.w >= 180 && b.h >= 120) findings.push({ level: 'warn', k: kOf(img), message: `#${kOf(img)} 是模板自带的大图（${b.w}×${b.h}，不是稿件图片）：如果是样例照片，请删除。` });
  }
  if (doc.documentElement.scrollWidth > WIDTH + 2) findings.push({ level: 'error', message: `页面横向溢出（内容宽 ${doc.documentElement.scrollWidth}px，屏幕 ${WIDTH}px）。` });
  // Long stretches with nothing to read or look at.
  const visual = [...boxes.map(b => b.box), ...[...doc.images].map(i => boxOf(i.getBoundingClientRect())).filter(b => b.w > 30 && b.h > 30)].sort((a, b) => a.y - b.y);
  for (let i = 1; i < visual.length; i++) {
    const gap = visual[i].y - Math.max(...visual.slice(0, i).map(b => b.y + b.h));
    if (gap > 220) findings.push({ level: 'warn', message: `y=${visual[i].y - gap}–${visual[i].y} 有 ${gap}px 的大段空白。` });
  }

  // The listing: units in order with their content, so the model can name what it sees.
  const listing: string[] = [];
  const units = [...doc.querySelectorAll(`[${UNIT_MARK}], body > * [${MARK}]:not([${UNIT_MARK}] [${MARK}])`)];
  const seen = new Set<Element>();
  for (const u of units) {
    if (seen.has(u)) continue; seen.add(u);
    const ub = boxOf(u.getBoundingClientRect());
    const label = u.getAttribute(UNIT_MARK) ?? `模板外 ${marks(u).join(' ')}`;
    listing.push(`${label} #${kOf(u)} y=${ub.y}–${ub.y + ub.h}`);
    labels.push({ k: kOf(u), box: ub, bad: false });
    const inner = u.hasAttribute(UNIT_MARK) ? [...u.querySelectorAll(`[${MARK}]`)] : [u];
    for (const c of inner) {
      const cb = boxOf(c.getBoundingClientRect());
      if (c.tagName.toLowerCase() === 'img') listing.push(`  #${kOf(c)} [${marks(c).join(' ')}] 图片 ${cb.w}×${cb.h}`);
      else {
        const t = textOf(c), size = view.getComputedStyle(c).fontSize;
        listing.push(`  #${kOf(c)} [${marks(c).join(' ')}] ${size} 「${t.length > 24 ? `${t.slice(0, 20)}…${t.slice(-4)}` : t}」 y=${cb.y} h=${cb.h}`);
      }
      labels.push({ k: kOf(c), box: cb, bad: false });
    }
  }
  for (const f of findings) {
    if (!f.k) continue;
    const el = doc.querySelector(`[${KEY_MARK}="${f.k}"]`);
    if (el) labels.push({ k: f.k, box: boxOf(el.getBoundingClientRect()), bad: true });
  }
  return { listing, findings, height: doc.documentElement.scrollHeight, labels };
}

// ---------------------------------------------------------------------------
// Screenshot: the rendered page drawn through an SVG foreignObject
// ---------------------------------------------------------------------------

const imageCache = new Map<string, string>();

async function inlineImage(src: string, maxWidth = 600): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  const cached = imageCache.get(src);
  if (cached) return cached;
  try {
    const blob = await (await fetch(src)).blob();
    if (blob.type === 'image/svg+xml') { const url = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(blob); }); imageCache.set(src, url); return url; }
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: blob.type === 'image/png' || blob.type === 'image/gif' ? 'image/png' : 'image/jpeg', quality: 0.8 });
    const url = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(out); });
    imageCache.set(src, url);
    return url;
  } catch { return null; }
}

const TILE = 1000, SCALE = 1.5, MAX_TILES = 8;

async function screenshot(doc: Document, measured: Measured): Promise<Part[]> {
  const body = doc.body.cloneNode(true) as HTMLElement;
  const jobs: Promise<void>[] = [];
  for (const img of body.querySelectorAll('img')) jobs.push(inlineImage((img as HTMLImageElement).src).then(u => { if (u) img.setAttribute('src', u); else img.removeAttribute('src'); }));
  for (const image of body.querySelectorAll('image')) {
    const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
    if (href) jobs.push(inlineImage(new URL(href, location.origin).href).then(u => { if (u) { image.setAttribute('href', u); image.removeAttribute('xlink:href'); } }));
  }
  for (const el of body.querySelectorAll<HTMLElement>('[style*="url("]')) {
    const m = /url\((['"]?)([^'")]+)\1\)/.exec(el.getAttribute('style') ?? '');
    if (m) jobs.push(inlineImage(new URL(m[2], location.origin).href).then(u => { el.setAttribute('style', (el.getAttribute('style') ?? '').replace(m[0], u ? `url("${u}")` : 'none')); }));
  }
  await Promise.all(jobs);
  const height = Math.min(measured.height, TILE * MAX_TILES);
  const xhtml = new XMLSerializer().serializeToString(body).replace(/^<body/, '<div').replace(/<\/body>$/, '</div>');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><foreignObject width="100%" height="100%"><style>${FRAME_CSS.replace(/html,body\{[^}]*\}/, '')}</style>${xhtml}</foreignObject></svg>`;
  const picture = new Image();
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await picture.decode().catch(() => undefined);
  const tiles: Part[] = [];
  for (let top = 0; top < height; top += TILE) {
    const h = Math.min(TILE, height - top);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * SCALE; canvas.height = h * SCALE;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.scale(SCALE, SCALE);
    try { g.drawImage(picture, 0, top, WIDTH, h, 0, 0, WIDTH, h); } catch { /* an undrawable page still gets labels */ }
    // Element numbers, so the model can point at what it sees. Problems in red.
    g.font = 'bold 10px sans-serif';
    for (const l of measured.labels) {
      if (l.box.y + l.box.h < top || l.box.y > top + h) continue;
      const y = Math.max(l.box.y - top, 0);
      g.strokeStyle = l.bad ? 'rgba(220,0,0,.9)' : 'rgba(0,110,255,.45)';
      g.lineWidth = l.bad ? 1.5 : 0.75;
      g.strokeRect(l.box.x + 0.5, l.box.y - top + 0.5, Math.max(4, l.box.w - 1), Math.max(4, l.box.h - 1));
      const tag = `#${l.k}`, w = g.measureText(tag).width + 4;
      g.fillStyle = l.bad ? 'rgba(220,0,0,.9)' : 'rgba(0,110,255,.8)';
      g.fillRect(l.box.x, y, w, 12);
      g.fillStyle = '#fff'; g.fillText(tag, l.box.x + 2, y + 10);
    }
    const data = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
    tiles.push({ type: 'image', mime: 'image/jpeg', data });
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

function describe(action: AgentAction): string {
  switch (action.tool) {
    case 'look': return '查看版面';
    case 'inspect': return `检查 #${action.k}`;
    case 'set_plan': return '重新编排';
    case 'fix_structure': return '纠正结构';
    case 'style': return `调整 #${action.k}：${Object.entries(action.css).map(([k, v]) => `${k} ${v}`).join('、')}`;
    case 'remove': return `删除 #${action.k}`;
    case 'set_text': return `改换行 #${action.k}`;
    case 'finish': return '完成';
  }
}

/** Keep pictures only in the newest observation; older ones become a note (tokens). */
function compact(messages: Message[]): Message[] {
  const last = messages.map(m => m.role).lastIndexOf('user');
  return messages.map((m, i) => (i === last || typeof m.content === 'string' ? m : { role: m.role, content: m.content.map(p => (p.type === 'image' ? { type: 'text' as const, text: '［旧截图已省略］' } : p)) }));
}

export async function runLayoutAgent(input: AgentInput): Promise<AgentResult> {
  const { template, rules, resolveImage, signal } = input;
  const maxSteps = input.maxSteps ?? AGENT_MAX_STEPS, deadline = Date.now() + (input.maxMs ?? AGENT_MAX_MS);
  const schema = analyzeTemplate(template);
  let manuscript = input.manuscript;
  let pieces = manuscriptPieces(manuscript, rules);
  let plan: PlanEntry[] = input.plan && !reviewPlan(schema, pieces, input.plan).some(x => x.level === 'error') ? input.plan : autoPlan(schema, pieces);
  const build = () => numberElements(executePlan(template, manuscript, plan, { rules, resolveImage, mark: true }).html);
  let html = build();
  const title = () => formatArticleTitle(manuscript.title, rules);
  const steps: AgentStep[] = [];
  let images = true, finishTries = 0, lastFindings: LayoutFinding[] = [];

  const observe = async (): Promise<Part[]> => {
    const { frame, doc } = await renderFrame(html);
    try {
      const m = measure(doc);
      const findings = [...layoutFindings(html, rules), ...m.findings];
      lastFindings = findings;
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      const text = [
        `第 ${steps.length + 1}/${maxSteps} 步 · 剩余约 ${Math.floor(left / 60)} 分 ${left % 60} 秒。`,
        `版面（手机宽 ${WIDTH}px，总高 ${m.height}px）。截图里蓝框是元素编号，红框是检测到的问题：`,
        ...m.listing.slice(0, 160),
        findings.length ? '检测到的问题：' : '程序检测没有发现问题（仍请看截图判断美观）。',
        ...findings.slice(0, 60).map(f => `${f.level === 'error' ? '✖' : '⚠'} ${f.k ? `#${f.k} ` : ''}${f.message}`),
      ].join('\n');
      const shots = images ? await screenshot(doc, m).catch(() => []) : [];
      return [{ type: 'text', text }, ...shots];
    } finally { frame.remove(); }
  };

  const [unitsPart, piecesPart] = planPrompt(schema, pieces).split('\n稿件：\n');
  const intro = [
    '请审看并精修这篇图文的版面。',
    '模板单元（set_plan 用）：', unitsPart.split('\n模板：\n')[1] ?? '',
    '稿件编号：', piecesPart ?? '',
    `当前排版方案：${JSON.stringify({ entries: plan })}`,
    ...(input.structure ? ['段落清单（fix_structure 用，序号|标记|字数|当前角色|内容）：', input.structure.prompt.split('\n').slice(2).join('\n')] : []),
    '当前版面：',
  ].join('\n');
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: intro }, ...await observe()] }];

  const result = (stop: AgentResult['stop'], summary = '', unresolved = ''): AgentResult => ({ html: stripAgentMarks(html), steps, summary, unresolved, stop, findings: lastFindings });

  while (steps.length < maxSteps) {
    if (signal?.aborted) return result('cancelled');
    if (Date.now() > deadline) return result('budget', '', '时间用完');
    let reply: { text: string; images: boolean };
    try {
      reply = await api.request<{ text: string; images: boolean }>('/api/manuscript/agent', { method: 'POST', body: JSON.stringify({ messages: compact(messages), session: input.session }), signal });
    } catch (error) {
      if (signal?.aborted) return result('cancelled');
      if (error instanceof api.ApiError && error.status === 501) return result('unavailable');
      if (steps.length && error instanceof api.ApiError && error.status === 502) {
        // One retry for a flaky provider, then stop with what we have.
        try { reply = await api.request('/api/manuscript/agent', { method: 'POST', body: JSON.stringify({ messages: compact(messages), session: input.session }), signal }); }
        catch { return result('failed'); }
      } else return result(steps.length ? 'failed' : 'unavailable');
    }
    if (!reply.images) images = false;
    messages.push({ role: 'assistant', content: reply.text });
    const n = steps.length + 1;
    const parsed = parseAgentReply(reply.text);
    const step = (s: Omit<AgentStep, 'n'>) => { const full = { n, ...s }; steps.push(full); input.onStep?.(full, stripAgentMarks(html)); };
    if ('error' in parsed) {
      step({ thought: '', action: '回复格式不对', outcome: 'error', note: parsed.error });
      messages.push({ role: 'user', content: `动作无效：${parsed.error}` });
      continue;
    }
    const { thought, action } = parsed;
    let note = '', outcome: AgentStep['outcome'] = 'done', observation = true;

    if (action.tool === 'look') { outcome = 'looked'; note = '已重新查看'; }
    else if (action.tool === 'inspect') { outcome = 'looked'; note = inspectElement(html, action.k); observation = false; }
    else if (action.tool === 'set_plan') {
      const errors = reviewPlan(schema, pieces, action.entries).filter(x => x.level === 'error');
      if (errors.length) { outcome = 'rejected'; note = `方案未通过复核，没有应用：\n${errors.map((x, i) => `${i + 1}. ${x.message}`).join('\n')}`; observation = false; }
      else { plan = action.entries; html = build(); note = '已按新方案重排（之前的精修已丢弃）'; }
    } else if (action.tool === 'fix_structure') {
      if (!input.structure) { outcome = 'rejected'; note = '这次导入不能改结构。'; observation = false; }
      else {
        manuscript = input.structure.apply(action.patches);
        pieces = manuscriptPieces(manuscript, rules);
        plan = autoPlan(schema, pieces);
        html = build();
        note = `已按新结构重排，方案重置为规则方案：${JSON.stringify({ entries: plan })}\n新的稿件编号：\n${planPrompt(schema, pieces).split('\n稿件：\n')[1] ?? ''}`;
      }
    } else if (action.tool === 'finish') {
      const errors = lastFindings.filter(f => f.level === 'error');
      finishTries++;
      if (errors.length && (finishTries < 2 || !action.unresolved) && steps.length + 1 < maxSteps) {
        outcome = 'rejected';
        note = `终检未通过，还有 ${errors.length} 个严重问题：\n${errors.map(f => `✖ ${f.k ? `#${f.k} ` : ''}${f.message}`).join('\n')}\n请继续修改；确实无法修好的，在 finish 的 unresolved 里逐条写明原因。`;
        observation = false;
      } else {
        step({ thought, action: describe(action), outcome: 'finished', note: action.summary });
        return result(errors.length ? 'accepted-with-issues' : 'satisfied', action.summary, action.unresolved ?? (errors.length ? errors.map(f => f.message).join('；') : ''));
      }
    } else {
      const done = applyPolish(html, action, { rules, title: title(), subtitle: manuscript.subtitle });
      if ('error' in done) { outcome = 'rejected'; note = done.error; observation = false; }
      else { html = numberElements(done.html); note = done.done; }
    }
    step({ thought, action: describe(action), outcome, note });
    const head = `${outcome === 'rejected' ? '动作被驳回' : '结果'}：${note}`;
    messages.push({ role: 'user', content: observation ? [{ type: 'text', text: `${head}\n\n新的版面：` }, ...await observe()] : head });
  }
  return result('budget', '', lastFindings.filter(f => f.level === 'error').map(f => f.message).join('；'));
}
