import {
  DEFAULT_RULES,
  analyzeTemplate,
  annotateSystem,
  annotationRequest,
  manuscriptPieces,
  planSystem,
  layoutAgentSystem,
  reviewPlan,
  applyAnnotations,
  assembleManuscript,
  classifyFacts,
  fillTemplate,
  formatArticleTitle,
  lintBlocks,
  parsePlan,
  manuscriptImages,
  normalizeRules,
  outlineOf,
  plainArticle,
  sanitizeHtml,
  validateHtml,
  type Block,
  type DocOp,
  type KiumiDocument,
  type Manuscript,
  type PlanEntry,
  type SourceFact,
  type TypesetRules,
} from '@kiumi/core';
import { dataFetch } from './data.js';
import { runModel, type ChatMessage, type ChatPart } from './llm.js';
import { commitOps, loadDocument } from './docs.js';
import type { Env } from './index.js';
import { ApiError, reply, teamContext } from './workspace.js';

export interface Deps {
  getTemplate(id: string): Promise<{ atomTplId: string; html: string; displayName?: string } | null>;
  /** Render a stored document with image URLs readable without a login. */
  previewHtml(doc: KiumiDocument, origin: string): Promise<string>;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function hmac(env: Env, scope: string, value: string): Promise<string> {
  if (!env.KIUMI_DATA_KEY) throw new ApiError(503, 'NOT_CONFIGURED', '服务尚未配置签名密钥');
  const key = await crypto.subtle.importKey('raw', enc.encode(`${scope}:${env.KIUMI_DATA_KEY}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))));
}

/** Short-lived signed capability: who may do what, until when. */
export async function signToken(env: Env, scope: string, payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, x: Math.floor(Date.now() / 1000) + ttlSeconds })));
  return `${body}.${await hmac(env, scope, body)}`;
}

export async function verifyToken<T = Record<string, any>>(env: Env, scope: string, token: string | null): Promise<T> {
  const [body, sig] = (token ?? '').split('.');
  if (!body || !sig || sig !== (await hmac(env, scope, body))) throw new ApiError(403, 'TOKEN_INVALID', '链接无效');
  const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
  if (!payload.x || payload.x < Math.floor(Date.now() / 1000)) throw new ApiError(403, 'TOKEN_EXPIRED', '链接已过期，请重新获取');
  return payload as T;
}

// ---------------------------------------------------------------------------
// Team rules
// ---------------------------------------------------------------------------

export async function teamRules(env: Env, teamId: string): Promise<TypesetRules> {
  const row = await env.DB.prepare('SELECT typeset_rules FROM teams WHERE id=?').bind(teamId).first<{ typeset_rules: string | null }>();
  try { return normalizeRules(row?.typeset_rules ? JSON.parse(row.typeset_rules) : null); } catch { return { ...DEFAULT_RULES }; }
}

export async function saveTeamRules(env: Env, teamId: string, patch: Partial<TypesetRules>): Promise<TypesetRules> {
  const next = normalizeRules({ ...(await teamRules(env, teamId)), ...patch });
  await env.DB.prepare('UPDATE teams SET typeset_rules=? WHERE id=?').bind(JSON.stringify(next), teamId).run();
  return next;
}

// ---------------------------------------------------------------------------
// Stored manuscript
// ---------------------------------------------------------------------------

export interface StoredManuscript {
  title: string;
  /** Facts with image references already resolved to /uploads URLs. */
  facts: SourceFact[];
  /** Accumulated `[index, role]` corrections from a model or Agent. */
  patches: unknown[];
  /** Style template the document is currently poured into. */
  style?: string;
  /** Layout plan an Agent submitted for `style`; dropped when the style or structure changes. */
  plan?: PlanEntry[];
  warnings: string[];
}

async function loadStored(env: Env, docId: string): Promise<StoredManuscript | null> {
  const row = await env.DB.prepare('SELECT data FROM manuscripts WHERE doc_id=?').bind(docId).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as StoredManuscript) : null;
}

async function saveStored(env: Env, teamId: string, docId: string, data: StoredManuscript): Promise<void> {
  await env.DB.prepare('INSERT INTO manuscripts(doc_id,team_id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(doc_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
    .bind(docId, teamId, JSON.stringify(data), new Date().toISOString()).run();
}

export function recognizeStored(stored: StoredManuscript) {
  let classified = classifyFacts(stored.facts);
  for (const patch of stored.patches) classified = applyAnnotations(classified, [patch]);
  const manuscript = assembleManuscript(stored.facts, classified, stored.title);
  return { manuscript, classified };
}

export interface BuildReport {
  title: string;
  outline: string[];
  images: number;
  style?: string;
  fill?: unknown;
  /** Compact prompt listing only the paragraphs still uncertain; empty when nothing is. */
  uncertain: { ask: number[]; prompt: string };
  warnings: string[];
}

/** Turn the stored manuscript into document blocks, styled when a template is set. */
export async function buildBlocks(env: Env, deps: Deps, stored: StoredManuscript, rules: TypesetRules): Promise<{ blocks: Block[]; manuscript: Manuscript; report: BuildReport }> {
  const { manuscript, classified } = recognizeStored(stored);
  const warnings = [...stored.warnings];
  let blocks: Block[];
  let fill: unknown;
  const stamp = Date.now().toString(36);
  if (stored.style) {
    const record = await deps.getTemplate(stored.style);
    if (!record) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', `风格模板 ${stored.style} 不存在`);
    const html = sanitizeHtml(record.html);
    // Agent flows plan with the Agent's own model (kiumi_describe_style -> kiumi_apply_style plan); otherwise rules.
    const result = fillTemplate(html, manuscript, { rules, resolveImage: ref => ref, plan: stored.plan, planSource: 'agent' });
    warnings.push(...result.report.warnings);
    fill = result.report;
    blocks = [{ kind: 'library', id: `blk-${stamp}`, tplId: record.atomTplId, matrix: [], html: result.html }];
  } else {
    blocks = plainArticle(manuscript, rules).map((html, i) => ({ kind: 'library' as const, id: `blk-${stamp}-${i}`, tplId: 'imported:稿件', matrix: [], html }));
  }
  const uncertain = annotationRequest(stored.facts, classified);
  return {
    blocks,
    manuscript,
    report: { title: manuscript.title, outline: outlineOf(manuscript), images: manuscriptImages(manuscript).length, style: stored.style, fill, uncertain, warnings },
  };
}

async function writeDocument(env: Env, deps: Deps, teamId: string, docId: string, stored: StoredManuscript, rules: TypesetRules) {
  const { blocks, manuscript, report } = await buildBlocks(env, deps, stored, rules);
  const cover = manuscriptImages(manuscript)[0];
  const ops: DocOp[] = [{ op: 'set', blocks, title: formatArticleTitle(manuscript.title, rules).slice(0, 200), meta: { ...(cover ? { cover } : {}), ...(manuscript.byline?.writer ? { author: manuscript.byline.writer } : {}) } }];
  const { doc } = await commitOps(env, teamId, docId, ops, 'agent');
  await saveStored(env, teamId, docId, stored);
  return { doc, report };
}

/** Re-pour the stored manuscript with a different style or extra role corrections. */
export async function restyle(env: Env, deps: Deps, teamId: string, docId: string, change: { style?: string | null; patches?: unknown; plan?: unknown }) {
  await loadDocument(env, teamId, docId);
  const stored = await loadStored(env, docId);
  if (!stored) throw new ApiError(404, 'NO_MANUSCRIPT', '这篇文稿不是由稿件导入生成的，没有可重新排版的原稿。请先导入稿件。');
  if (change.style !== undefined && change.style !== stored.style) { stored.style = change.style ?? undefined; stored.plan = undefined; }
  if (Array.isArray(change.patches)) { stored.patches = [...stored.patches, ...change.patches.filter(p => Array.isArray(p) && p.length >= 2)]; stored.plan = undefined; }
  if (change.plan !== undefined) {
    const plan = change.plan === null ? null : parsePlan(change.plan);
    if (change.plan !== null && !plan) throw new ApiError(400, 'INVALID_PLAN', 'plan 需要是 {entries:[{u,t,img}]} 或其数组');
    if (plan) await checkPlan(deps, stored, plan, await teamRules(env, teamId));
    stored.plan = plan ?? undefined;
  }
  return writeDocument(env, deps, teamId, docId, stored, await teamRules(env, teamId));
}

/**
 * The mandatory review round for an Agent's plan: a plan that drops, repeats or
 * misplaces content is sent back with the list of problems instead of applied.
 */
async function checkPlan(deps: Deps, stored: StoredManuscript, plan: PlanEntry[], rules: TypesetRules) {
  if (!stored.style) throw new ApiError(409, 'STYLE_REQUIRED', '先用 style 指定风格模板，plan 才有对应的单元');
  const record = await deps.getTemplate(stored.style);
  if (!record) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', `风格模板 ${stored.style} 不存在`);
  const { manuscript } = recognizeStored(stored);
  const errors = reviewPlan(analyzeTemplate(sanitizeHtml(record.html)), manuscriptPieces(manuscript, rules), plan).filter(x => x.level === 'error');
  if (errors.length) throw new ApiError(422, 'PLAN_REJECTED', `排版方案未通过复核，没有应用。请全部改正后重新提交：\n${errors.map((x, i) => `${i + 1}. ${x.message}`).join('\n')}`);
}

// ---------------------------------------------------------------------------
// Import (presigned upload -> data service -> document)
// ---------------------------------------------------------------------------

const IMPORT_SCOPE = 'manuscript-import';

export async function beginImport(env: Env, origin: string, input: { userSub: string; teamId: string; documentId: string; style?: string }) {
  const token = await signToken(env, IMPORT_SCOPE, { u: input.userSub, t: input.teamId, d: input.documentId, s: input.style ?? null }, 15 * 60);
  const url = `${origin}/api/import/manuscript?token=${token}`;
  return { uploadUrl: url, expiresInSeconds: 900, maxBytes: 120 * 1024 * 1024, curl: `curl -sS -X POST --data-binary @<稿件.zip> '${url}'` };
}

interface DataResult {
  docName: string;
  facts: SourceFact[];
  warnings: string[];
  refs: Record<string, { id: string; mime: string; bytes: number; name: string; key: string }>;
  matches: { ref: string; original: string | null; level: string; confidence: number; candidates: { name?: string; score: number }[] }[];
  unused: { id: string; name: string; mime: string; bytes: number; key: string }[];
}

export async function importRoute(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const claim = await verifyToken<{ u: string; t: string; d: string; s: string | null }>(env, IMPORT_SCOPE, url.searchParams.get('token'));
  // The token is the credential, but the user must still belong to the team.
  const member = await env.DB.prepare('SELECT 1 FROM members WHERE team_id=? AND user_sub=?').bind(claim.t, claim.u).first();
  if (!member) throw new ApiError(403, 'TEAM_FORBIDDEN', '你不是该团队的成员');
  await loadDocument(env, claim.t, claim.d);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (!request.body) throw new ApiError(400, 'INVALID_BODY', '请以请求体上传稿件 ZIP 或 DOCX');
  if (length > 120 * 1024 * 1024) throw new ApiError(413, 'TOO_LARGE', '文件超过 120 MB');

  let upstream: Response;
  try {
    upstream = await dataFetch(env, `manuscript/import?team=${encodeURIComponent(claim.t)}`, {
      method: 'POST', body: request.body, headers: { 'content-type': 'application/octet-stream', ...(length ? { 'content-length': String(length) } : {}) },
      signal: AbortSignal.timeout(300_000), duplex: 'half',
    } as RequestInit);
  } catch { throw new ApiError(503, 'IMPORT_UNAVAILABLE', '稿件处理服务暂时不可用，请稍后重试'); }
  const payload = await upstream.json().catch(() => null) as { ok?: boolean; data?: DataResult; error?: string } | null;
  if (!upstream.ok || !payload?.ok || !payload.data) throw new ApiError(upstream.status === 413 ? 413 : 422, 'IMPORT_FAILED', payload?.error ?? '稿件无法解析');
  const data = payload.data;

  // Register stored images in the team gallery (files are already written).
  const stamp = new Date().toISOString();
  const registered = new Map<string, string>();
  const all = [...Object.values(data.refs), ...data.unused];
  for (const image of all) {
    await env.DB.prepare('INSERT INTO uploads VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(image.id, claim.t, image.name.slice(0, 200), image.key, image.mime, image.bytes, stamp).run();
    registered.set(image.id, `/uploads/${image.id}`);
  }
  const urlOf = (ref: string) => (data.refs[ref] ? `/uploads/${data.refs[ref].id}` : null);
  const facts = data.facts.map(f => ({
    ...f,
    images: f.images?.map(r => urlOf(r) ?? r),
    html: f.html,
  }));
  const stored: StoredManuscript = { title: '稿件', facts, patches: [], style: claim.s ?? undefined, warnings: data.warnings };
  const rules = await teamRules(env, claim.t);
  const { doc, report } = await writeDocument(env, deps, claim.t, claim.d, { ...stored, title: recognizeStored(stored).manuscript.title }, rules);

  const low = data.matches.filter(m => m.level !== 'high');
  const lint = await lintDocument(env, deps, claim.t, doc, url.origin);
  return reply({
    documentId: claim.d,
    rev: doc.meta.rev,
    source: data.docName,
    ...report,
    // Mandatory review of what was written: house rules and WeChat checks.
    review: { passed: !lint.style.length && !lint.wechat.some(x => x.level === 'error'), style: lint.style, wechat: lint.wechat },
    images: {
      placeholders: data.matches.length,
      matchedToOriginals: data.matches.filter(m => m.original).length,
      needReview: low.map(m => ({ ref: m.ref, original: m.original, level: m.level, confidence: m.confidence, candidates: m.candidates.map(c => c.name) })),
      unusedOriginalsInGallery: data.unused.map(u => u.name),
    },
  });
}

// ---------------------------------------------------------------------------
// Lint and preview
// ---------------------------------------------------------------------------

export async function lintDocument(env: Env, deps: Deps, teamId: string, doc: KiumiDocument, origin: string) {
  const rules = await teamRules(env, teamId);
  const blocks = doc.blocks.map(b => ({
    html: b.kind === 'library' ? b.html ?? '' : b.node.html ?? b.node.text ?? '',
    strict: b.kind === 'native' || (b.kind === 'library' && String(b.tplId).startsWith('imported:')),
  }));
  const style = lintBlocks(blocks, rules, { title: doc.title });
  const rendered = await deps.previewHtml(doc, origin);
  const wechat = validateHtml(rendered);
  return {
    blocks: doc.blocks.length,
    style: style.map(i => ({ ...i, blockId: i.block === undefined ? undefined : doc.blocks[i.block]?.id })),
    wechat: wechat.filter(i => i.level !== 'info').map(i => ({ rule: i.rule, level: i.level, message: i.message })),
    digest: doc.meta.digest ? 'ok' : '缺少摘要',
    cover: doc.meta.cover ? 'ok' : '缺少封面',
  };
}

const PREVIEW_SCOPE = 'doc-preview';

export async function previewLink(env: Env, origin: string, teamId: string, docId: string) {
  const token = await signToken(env, PREVIEW_SCOPE, { t: teamId, d: docId }, 3600);
  return { url: `${origin}/api/preview/${encodeURIComponent(docId)}?token=${token}`, expiresInSeconds: 3600 };
}

export async function previewRoute(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const docId = decodeURIComponent(url.pathname.slice('/api/preview/'.length));
  const claim = await verifyToken<{ t: string; d: string }>(env, PREVIEW_SCOPE, url.searchParams.get('token'));
  if (claim.d !== docId) throw new ApiError(403, 'TOKEN_INVALID', '链接无效');
  const doc = await loadDocument(env, claim.t, docId);
  const html = await deps.previewHtml(doc, url.origin);
  const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${doc.title.replace(/[<>&]/g, '')}</title><style>body{margin:0;background:#ededed}main{max-width:677px;margin:0 auto;background:#fff;padding:20px 0;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.6;color:#000}img{max-width:100%}h1{font-size:22px;padding:0 20px;margin:0 0 12px}</style></head><body><main><h1>${doc.title.replace(/[<>&]/g, '')}</h1>${html}</main></body></html>`;
  return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src *; media-src *" } });
}

// ---------------------------------------------------------------------------
// Optional model second opinion for the web importer
// ---------------------------------------------------------------------------

/** The browser's id for one import, so its model calls share a gateway session. */
const sessionId = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : undefined);

/** Structure recognition: role corrections for the listed paragraphs. */
export async function annotateRoute(request: Request, env: Env): Promise<Response> {
  const { teamId } = await teamContext(env, request);
  const { prompt, session } = await request.json() as { prompt?: string; session?: string };
  if (typeof prompt !== 'string' || !prompt || prompt.length > 20_000) throw new ApiError(400, 'INVALID_BODY', '提示内容无效');
  const { text } = await runModel(env, 'annotate', annotateSystem(await teamRules(env, teamId)), prompt, { session: sessionId(session) });
  const match = /\[[\s\S]*\]/.exec(text);
  let patches: unknown = [];
  try { patches = match ? JSON.parse(match[0]) : []; } catch { patches = []; }
  return reply({ patches: Array.isArray(patches) ? patches.slice(0, 400) : [] });
}

/**
 * Layout planning for the web importer: the browser builds the prompt (and,
 * for a review round, the follow-up with the rejected plan and its problems)
 * with the same core code. The system prompt carries this team's house rules.
 */
export async function planRoute(request: Request, env: Env): Promise<Response> {
  const { teamId } = await teamContext(env, request);
  const { prompt, session } = await request.json() as { prompt?: string; session?: string };
  if (typeof prompt !== 'string' || !prompt || prompt.length > 60_000) throw new ApiError(400, 'INVALID_BODY', '提示内容无效');
  const { text } = await runModel(env, 'plan', planSystem(await teamRules(env, teamId)), prompt, { session: sessionId(session) });
  const plan = parsePlan(text);
  if (!plan) throw new ApiError(502, 'LLM_FAILED', '模型没有给出可用的排版方案，已使用规则排版');
  return reply({ entries: plan });
}

/** Limits for one layout-review step: the conversation so far, with screenshots. */
const AGENT_LIMITS = { messages: 80, bytes: 8 * 1024 * 1024, images: 12, imageBytes: 1_500_000 };

function agentMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input) || !input.length || input.length > AGENT_LIMITS.messages) throw new ApiError(400, 'INVALID_BODY', '对话内容无效');
  let bytes = 0, images = 0;
  const out = input.map((m: any, i): ChatMessage => {
    const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null;
    if (!role || (i === 0 && role !== 'user')) throw new ApiError(400, 'INVALID_BODY', '对话需从用户消息开始');
    const parts: ChatPart[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content.map((p: any): ChatPart => {
      if (p?.type === 'text' && typeof p.text === 'string') { bytes += p.text.length; return { type: 'text', text: p.text }; }
      if (role === 'user' && p?.type === 'image' && /^image\/(jpeg|png|webp)$/.test(p.mime) && typeof p.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(p.data) && p.data.length <= AGENT_LIMITS.imageBytes) {
        images++; bytes += p.data.length; return { type: 'image', mime: p.mime, data: p.data };
      }
      throw new ApiError(400, 'INVALID_BODY', '对话里有无法识别的内容');
    }) : [];
    if (!parts.length) throw new ApiError(400, 'INVALID_BODY', '对话里有空消息');
    return { role, content: parts };
  });
  if (bytes > AGENT_LIMITS.bytes || images > AGENT_LIMITS.images) throw new ApiError(413, 'TOO_LARGE', '对话或截图太大');
  return out;
}

/**
 * One step of the layout review loop (ReAct) the web importer runs: the
 * browser renders, measures and screenshots the article, sends the whole
 * conversation, and gets back the model's next thought and action. The system
 * prompt carries this team's rules; the loop itself stays in the browser.
 */
export async function agentRoute(request: Request, env: Env): Promise<Response> {
  const { teamId } = await teamContext(env, request);
  const body = await request.json().catch(() => null) as { messages?: unknown; session?: string } | null;
  const messages = agentMessages(body?.messages);
  const { text, images } = await runModel(env, 'polish', layoutAgentSystem(await teamRules(env, teamId)), messages, { session: sessionId(body?.session) });
  return reply({ text, images });
}

// ---------------------------------------------------------------------------
// Team rules routes
// ---------------------------------------------------------------------------

export async function rulesRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/teams/typeset') return null;
  const { teamId, role } = await teamContext(env, request);
  if (request.method === 'GET') return reply(await teamRules(env, teamId));
  if (request.method === 'PUT') {
    if (role !== 'owner') throw new ApiError(403, 'OWNER_REQUIRED', '只有团队创建者可以修改排版规范');
    return reply(await saveTeamRules(env, teamId, (await request.json()) as Partial<TypesetRules>));
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持的操作');
}
