import { analyzeTemplate, outlineOf, sanitizeHtml, validateOps, type DocOp, type TypesetRules } from '@kiumi/core';
import { bearerUser, type SessionUser } from './auth.js';
import { dataFetch } from './data.js';
import { commitOps, loadDocument } from './docs.js';
import type { Env } from './index.js';
import { beginImport, lintDocument, previewLink, recognizeStored, restyle, saveTeamRules, teamRules, type Deps } from './manuscript.js';
import { ApiError } from './workspace.js';

/**
 * Remote MCP server (Streamable HTTP, stateless JSON responses) protected by
 * OAuth bearer tokens from the shared identity provider. Tools are layered:
 * a few workflow tools do whole jobs (import a submission, restyle), and small
 * editing tools let an Agent make precise corrections afterwards. Every write
 * goes through the document ops service, so an open editor updates live.
 */

const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];

type WechatDraft = (request: Request, env: Env, input: { documentId: string; accountId: string; cover?: string }) => Promise<unknown>;

interface Ctx { env: Env; request: Request; user: SessionUser; deps: Deps; origin: string; wechatDraft: WechatDraft }

interface Tool {
  name: string;
  description: string;
  readOnly?: boolean;
  properties: Record<string, unknown>;
  required?: string[];
  run(ctx: Ctx, args: any): Promise<unknown>;
}

const str = (description: string) => ({ type: 'string', description });
const TEAM = str('团队编号或名称；只属于一个团队时可省略');
const DOC = str('文稿编号');

async function teams(ctx: Ctx) {
  return (await ctx.env.DB.prepare('SELECT t.id,t.name,m.role FROM teams t JOIN members m ON m.team_id=t.id WHERE m.user_sub=? ORDER BY t.created_at').bind(ctx.user.sub).all<{ id: string; name: string; role: string }>()).results;
}

async function team(ctx: Ctx, wanted?: string) {
  const list = await teams(ctx);
  if (!list.length) throw new ApiError(409, 'TEAM_REQUIRED', '你还没有团队，请先在 Kiumi 网站创建或加入团队');
  if (wanted) {
    const found = list.find(t => t.id === wanted || t.name === wanted);
    if (!found) throw new ApiError(403, 'TEAM_FORBIDDEN', `你不是团队「${wanted}」的成员`);
    return found;
  }
  if (list.length > 1) throw new ApiError(409, 'TEAM_REQUIRED', `你属于多个团队，请用 team 参数指定：${list.map(t => `${t.name}(${t.id})`).join('、')}`);
  return list[0]!;
}

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function summarize(doc: Awaited<ReturnType<typeof loadDocument>>) {
  return doc.blocks.map((b, i) => {
    const html = b.kind === 'library' ? b.html ?? '' : b.node.html ?? b.node.text ?? '';
    return { i, id: b.id, kind: b.kind, tpl: b.kind === 'library' ? b.tplId : b.node.kind, text: text(html).slice(0, 60), images: (html.match(/<img\b/gi) ?? []).length, bytes: html.length };
  });
}

const TOOLS: Tool[] = [
  {
    name: 'kiumi_whoami', readOnly: true, description: '查看当前登录用户及其所在团队。',
    properties: {},
    async run(ctx) { return { user: { sub: ctx.user.sub, name: ctx.user.name }, teams: await teams(ctx) }; },
  },
  {
    name: 'kiumi_list_documents', readOnly: true, description: '列出团队里的文稿（编号、标题、修订号）。',
    properties: { team: TEAM },
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      return (await ctx.env.DB.prepare('SELECT id,title,updated_at AS updatedAt,rev FROM documents WHERE team_id=? ORDER BY updated_at DESC LIMIT 100').bind(t.id).all()).results;
    },
  },
  {
    name: 'kiumi_create_document', description: '新建一篇空文稿，返回文稿编号。导入稿件前先建稿。',
    properties: { title: str('标题（1–200 字）'), team: TEAM }, required: ['title'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      const title = String(a.title ?? '').trim();
      if (!title || title.length > 200) throw new ApiError(400, 'INVALID_BODY', '标题需 1–200 字');
      const id = `doc_${crypto.randomUUID()}`, stamp = new Date().toISOString();
      await ctx.env.DB.prepare('INSERT INTO documents(id,title,blocks,updated_at,owner_sub,team_id,meta) VALUES (?,?,?,?,?,?,?)').bind(id, title, '[]', stamp, ctx.user.sub, t.id, '{}').run();
      return { documentId: id, team: t.id, title };
    },
  },
  {
    name: 'kiumi_get_document', readOnly: true,
    description: '读取文稿。view=outline（默认）只返回每个块的摘要，省 token；view=full 返回完整块与 HTML；view=block 配合 blockId 只返回一个块。',
    properties: { documentId: DOC, team: TEAM, view: { type: 'string', enum: ['outline', 'full', 'block'] }, blockId: str('view=block 时的块编号') }, required: ['documentId'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      const doc = await loadDocument(ctx.env, t.id, a.documentId);
      const head = { documentId: doc.id, title: doc.title, rev: doc.meta.rev, meta: { digest: doc.meta.digest, cover: doc.meta.cover, author: doc.meta.author, tags: doc.meta.tags } };
      if (a.view === 'full') return { ...head, blocks: doc.blocks };
      if (a.view === 'block') {
        const block = doc.blocks.find(b => b.id === a.blockId);
        if (!block) throw new ApiError(404, 'BLOCK_NOT_FOUND', `找不到块 ${a.blockId}`);
        return { ...head, block };
      }
      return { ...head, blocks: summarize(doc) };
    },
  },
  {
    name: 'kiumi_search_styles', readOnly: true, description: '搜索「风格排版」模板（关键词如 校园、党政、秋天、喜庆）。返回模板编号与名称。',
    properties: { q: str('关键词'), limit: { type: 'integer', minimum: 1, maximum: 30 } },
    async run(ctx, a) {
      const params = new URLSearchParams({ room: 'modern:风格排版', limit: String(Math.min(30, Math.max(1, Number(a.limit) || 10))) });
      if (a.q) params.set('q', String(a.q));
      const response = await dataFetch(ctx.env, `catalog/query?${params}`);
      const payload = await response.json() as { data?: { atomTplId: string; displayName: string }[] };
      return (payload.data ?? []).map(x => ({ atomTplId: x.atomTplId, name: x.displayName }));
    },
  },
  {
    name: 'kiumi_describe_style', readOnly: true, description: '查看一个风格模板的版面结构：有几处正文、几处图片位、是否有大标题/副标题。',
    properties: { atomTplId: str('模板编号，如 shop:paper/100584') }, required: ['atomTplId'],
    async run(ctx, a) {
      const record = await ctx.deps.getTemplate(String(a.atomTplId));
      if (!record) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', '模板不存在');
      const schema = analyzeTemplate(sanitizeHtml(record.html));
      return { atomTplId: record.atomTplId, name: record.displayName, ...schema.summary, units: schema.units.length };
    },
  },
  {
    name: 'kiumi_begin_import',
    description: '开始导入稿件压缩包（Word + 相机原图）。返回一个 15 分钟有效的上传地址：请用 shell 执行返回的 curl 命令把 ZIP 或 DOCX 上传到该地址，上传请求本身会完成解析、原图匹配、套用风格并写入文稿，响应里是识别结果与需要核对的项目。',
    properties: { documentId: DOC, style: str('可选：风格模板编号（先用 kiumi_search_styles 找）；不填则不套模板'), team: TEAM }, required: ['documentId'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      await loadDocument(ctx.env, t.id, a.documentId);
      return beginImport(ctx.env, ctx.origin, { userSub: ctx.user.sub, teamId: t.id, documentId: a.documentId, style: a.style });
    },
  },
  {
    name: 'kiumi_get_manuscript', readOnly: true,
    description: '查看已导入稿件的识别结果：文章结构大纲，以及仍不确定的段落（uncertain.prompt 是精简清单，只含这几行）。',
    properties: { documentId: DOC, team: TEAM }, required: ['documentId'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      await loadDocument(ctx.env, t.id, a.documentId);
      const row = await ctx.env.DB.prepare('SELECT data FROM manuscripts WHERE doc_id=?').bind(a.documentId).first<{ data: string }>();
      if (!row) throw new ApiError(404, 'NO_MANUSCRIPT', '这篇文稿没有导入过稿件');
      const stored = JSON.parse(row.data);
      const { manuscript, classified } = recognizeStored(stored);
      const { annotationRequest } = await import('@kiumi/core');
      return { style: stored.style, outline: outlineOf(manuscript), uncertain: annotationRequest(stored.facts, classified), warnings: stored.warnings };
    },
  },
  {
    name: 'kiumi_apply_style', description: '把已导入的稿件换一个风格模板重新排版（style 传 null 则取消模板，用纯文字排版）。会整体替换文稿内容。',
    properties: { documentId: DOC, style: { type: ['string', 'null'], description: '风格模板编号或 null' }, team: TEAM }, required: ['documentId', 'style'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      const { doc, report } = await restyle(ctx.env, ctx.deps, t.id, a.documentId, { style: a.style });
      return { rev: doc.meta.rev, ...report };
    },
  },
  {
    name: 'kiumi_fix_structure',
    description: '纠正结构识别：patches 是 [[段落序号, 角色]] 数组，角色码 t主标题 s副标题 h1/h2/h3 标题层级 b正文 y署名 c图注。序号来自 kiumi_get_manuscript 的 uncertain 清单。纠正后文稿会重新排版。',
    properties: { documentId: DOC, patches: { type: 'array', items: { type: 'array' } }, team: TEAM }, required: ['documentId', 'patches'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      const { doc, report } = await restyle(ctx.env, ctx.deps, t.id, a.documentId, { patches: a.patches });
      return { rev: doc.meta.rev, ...report };
    },
  },
  {
    name: 'kiumi_edit_document',
    description: '精细修改文稿，ops 为操作数组：{op:"title",title} {op:"meta",meta:{digest,cover,author,tags}} {op:"insert",blocks:[…],at:数字|"end"|{after:块id}} {op:"replace",id,block} {op:"html",id,html} {op:"remove",ids:[…]} {op:"move",id,to}。块 id 见 kiumi_get_document。修改会立即出现在已打开的编辑画布上。',
    properties: { documentId: DOC, ops: { type: 'array', items: { type: 'object' } }, team: TEAM }, required: ['documentId', 'ops'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      let ops: DocOp[];
      try { ops = validateOps(a.ops); } catch (error) { throw new ApiError(400, 'INVALID_OPS', (error as Error).message); }
      const { doc } = await commitOps(ctx.env, t.id, a.documentId, ops, 'agent');
      return { rev: doc.meta.rev, blocks: doc.blocks.length };
    },
  },
  {
    name: 'kiumi_replace_text', description: '在文稿的 HTML 文字里查找并替换（不会改标签与样式）。blockId 省略时作用于全部块。',
    properties: { documentId: DOC, find: str('要查找的文字'), replace: str('替换成'), blockId: str('只改这个块'), team: TEAM }, required: ['documentId', 'find', 'replace'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      const doc = await loadDocument(ctx.env, t.id, a.documentId);
      const find = String(a.find), replace = String(a.replace);
      if (!find) throw new ApiError(400, 'INVALID_BODY', 'find 不能为空');
      const escaped = replace.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const ops: DocOp[] = [];
      let count = 0;
      for (const block of doc.blocks) {
        if (block.kind !== 'library' || !block.html || (a.blockId && block.id !== a.blockId)) continue;
        // Only text between tags is touched.
        const next = block.html.replace(/>([^<]*)</g, (m, inner: string) => {
          if (!inner.includes(find)) return m;
          count += inner.split(find).length - 1;
          return `>${inner.split(find).join(escaped)}<`;
        });
        if (next !== block.html) ops.push({ op: 'html', id: block.id, html: next });
      }
      if (!ops.length) return { replaced: 0 };
      const { doc: committed } = await commitOps(ctx.env, t.id, a.documentId, ops, 'agent');
      return { replaced: count, rev: committed.meta.rev };
    },
  },
  {
    name: 'kiumi_lint', readOnly: true, description: '审稿检查：按团队排版规范（字号、颜色、行距、图片宽度、空行、标题长度）和微信兼容规则检查，返回问题清单，含块编号。',
    properties: { documentId: DOC, team: TEAM }, required: ['documentId'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      return lintDocument(ctx.env, ctx.deps, t.id, await loadDocument(ctx.env, t.id, a.documentId), ctx.origin);
    },
  },
  {
    name: 'kiumi_preview_link', readOnly: true, description: '生成一个 1 小时有效的预览链接（手机宽度，图片可直接读取），用于审稿。',
    properties: { documentId: DOC, team: TEAM }, required: ['documentId'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      await loadDocument(ctx.env, t.id, a.documentId);
      return previewLink(ctx.env, ctx.origin, t.id, a.documentId);
    },
  },
  {
    name: 'kiumi_typeset_rules', description: '读取团队排版规范；传 set 则修改（仅团队创建者）。字段：bodySize headingSize headingBold textColor lineHeight letterSpacing paragraphGap sidePadding firstLineIndent imageWidth blankAroundImages blankAtEdges titleCutAtDelimiter titleCommaToSpace。',
    properties: { team: TEAM, set: { type: 'object' } },
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      if (a.set === undefined) return teamRules(ctx.env, t.id);
      if (t.role !== 'owner') throw new ApiError(403, 'OWNER_REQUIRED', '只有团队创建者可以修改排版规范');
      return saveTeamRules(ctx.env, t.id, a.set as Partial<TypesetRules>);
    },
  },
  {
    name: 'kiumi_create_wechat_draft', description: '把文稿同步到团队公众号的草稿箱（不会发表，发表由人在微信后台完成）。cover 省略时使用文稿封面。',
    properties: { documentId: DOC, accountId: str('公众号编号；团队只有一个公众号时可省略'), cover: str('封面图片地址'), team: TEAM }, required: ['documentId'],
    async run(ctx, a) {
      const t = await team(ctx, a.team);
      const doc = await loadDocument(ctx.env, t.id, a.documentId);
      const accounts = (await ctx.env.DB.prepare('SELECT id,name FROM wechat_accounts WHERE team_id=?').bind(t.id).all<{ id: string; name: string }>()).results;
      const account = a.accountId ? accounts.find(x => x.id === a.accountId || x.name === a.accountId) : accounts.length === 1 ? accounts[0] : undefined;
      if (!account) throw new ApiError(409, 'ACCOUNT_REQUIRED', `请指定 accountId：${accounts.map(x => `${x.name}(${x.id})`).join('、') || '团队尚未绑定公众号'}`);
      const cover = a.cover ?? doc.meta.cover;
      if (!cover) throw new ApiError(409, 'COVER_REQUIRED', '文稿没有封面，请先用 kiumi_edit_document 设置 meta.cover');
      // The draft route authenticates through the request, so it is replayed with the caller's token and team.
      const request = new Request(ctx.request.url, { headers: new Headers({ authorization: ctx.request.headers.get('authorization') ?? '', 'content-type': 'application/json', 'x-team-id': t.id }) });
      return ctx.wechatDraft(request, ctx.env, { documentId: a.documentId, accountId: account.id, cover });
    },
  },
];

const toolList = () => TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  inputSchema: { type: 'object', properties: t.properties, required: t.required ?? [], additionalProperties: false },
  annotations: { readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false },
}));

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(ctx: Ctx, message: any): Promise<unknown | null> {
  const { id, method, params } = message ?? {};
  if (id === undefined) return null; // notification
  switch (method) {
    case 'initialize': {
      const wanted = String(params?.protocolVersion ?? '');
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: PROTOCOLS.includes(wanted) ? wanted : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kiumi', version: '0.2.0' },
        instructions: 'Kiumi 排版工作流：kiumi_create_document → kiumi_search_styles → kiumi_begin_import（用 curl 上传稿件 ZIP）→ kiumi_get_manuscript / kiumi_fix_structure 校正 → kiumi_edit_document 微调 → kiumi_lint 与 kiumi_preview_link 审稿 → 提醒人工在编辑器核对，再 kiumi_create_wechat_draft。',
      } };
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: toolList() } };
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) return rpcError(id, -32602, `未知工具 ${params?.name}`);
      try {
        const out = await tool.run(ctx, params?.arguments ?? {});
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { items: out } : out } };
      } catch (error) {
        const detail = error instanceof ApiError ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: '工具执行失败' };
        if (!(error instanceof ApiError)) console.error('mcp tool failed', params?.name, (error as Error).message);
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(detail) }] } };
      }
    }
    default: return rpcError(id, -32601, `不支持的方法 ${method}`);
  }
}

const metadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/mcp`;

export async function mcpRoutes(request: Request, env: Env, deps: Deps, wechatDraft: WechatDraft): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;

  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    if (!env.ID_ISSUER_URL) return Response.json({ error: 'not_configured' }, { status: 503 });
    return Response.json({
      resource: `${origin}/mcp`,
      authorization_servers: [env.ID_ISSUER_URL.replace(/\/$/, '')],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'profile', 'email'],
      resource_name: 'Kiumi',
    }, { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
  }
  if (url.pathname !== '/mcp') return null;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,mcp-protocol-version,mcp-session-id', 'access-control-allow-methods': 'POST,OPTIONS' } });
  if (request.method !== 'POST') return new Response('此服务只接受 POST', { status: 405, headers: { allow: 'POST, OPTIONS' } });

  const user = await bearerUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${metadataUrl(origin)}", scope="openid profile email"` },
    });
  }

  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json(rpcError(null, -32700, '请求不是合法 JSON'), { status: 400 }); }
  const ctx: Ctx = { env, request, user, deps, origin, wechatDraft };
  if (Array.isArray(payload)) {
    const results = (await Promise.all(payload.map(m => handle(ctx, m)))).filter(r => r !== null);
    return results.length ? Response.json(results) : new Response(null, { status: 202 });
  }
  const result = await handle(ctx, payload);
  return result === null ? new Response(null, { status: 202 }) : Response.json(result, { headers: { 'cache-control': 'no-store' } });
}
