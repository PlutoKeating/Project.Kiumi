# API 契约

## 生产团队 API（优先于下方本地服务契约）

生产 Worker 使用 HttpOnly 会话。团队资源请求附带 `X-Team-Id`，服务端验证成员身份。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET/POST | `/api/teams` | 我的团队 / 创建团队 |
| POST | `/api/teams/join` | `{code}` 加入团队 |
| GET/DELETE | `/api/teams/members` | 成员列表 / 创建者移除 `{userId}` |
| POST | `/api/teams/invite` | 创建者生成 7 天邀请码，旧码失效 |
| GET/POST | `/api/documents` | 团队文稿列表 / 创建（title、blocks、meta） |
| GET/PATCH/DELETE | `/api/documents/:id` | 团队文稿读取、更新、删除 |
| GET | `/api/uploads` | 团队图库 |
| POST | `/api/assets/upload` | multipart 图片，PNG/JPEG/GIF/WebP，最多 10 MB |
| GET | `/uploads/:id` | 成员读取；导出签名链接允许外部读取 |
| GET/POST | `/api/accounts` | 团队公众号列表 / 创建者验证并绑定 `{name,appId,secret}` |
| DELETE | `/api/accounts/:id` | 创建者解除绑定 |
| POST | `/api/wechat/draft` | `{documentId,accountId,cover,requestId}` 创建草稿并回读 |
| GET/PUT | `/api/teams/typeset` | 团队排版规范：成员读取，创建者保存 |
| WS | `/api/documents/:id/live` | 文稿实时通知（Cookie + `?team=` + `?client=`），消息 `{type:'changed',rev,by,from?,ops?}` |
| POST | `/api/manuscript/annotate` | `{prompt}`（`annotationRequest` 生成）结构识别的模型复核 `{patches}`，系统提示带本团队排版规范；未配置模型返回 501，网页回落到规则 |
| GET/PUT | `/api/admin/llm` | 站点管理员：模型提供商配置（Key 只写入）；`/api/admin/catalog`、`/api/admin/catalog/models`、`POST /api/admin/llm/test` 见 [MODELS.md](MODELS.md) |
| POST | `/api/manuscript/plan` | `{prompt}`（`planPrompt` 生成，复核轮次为 `reviewPrompt`）风格排版方案 `{entries:[{u,t,img}]}`，系统提示带本团队排版规范；网页对每个方案跑 `reviewPlan`，不合格最多再问 2 轮；未配置模型 501，模型无可用方案 502，网页回落到规则方案 |
| POST | `/api/manuscript/agent` | `{messages, session?}` 版面精修（ReAct）的一步：整段对话（用户消息可带 `{type:'image',mime,data}` 截图），系统提示带本团队规范，返回 `{text, images}`（`images:false` 表示模型不读图片、已改用纯文字）；最多 80 条消息、12 张图、8 MB；未配置模型 501 |
| POST | `/api/import/manuscript?token=` | 预签名上传：请求体为稿件 ZIP/DOCX，解析、匹配原图、排入风格并写入文稿，返回识别报告与规范审稿 `review` |
| GET | `/api/preview/:id?token=` | 签名预览页（手机宽度），1 小时有效 |
| POST | `/mcp` | 远程 MCP，Bearer 令牌，见 [MCP.md](MCP.md) |
| GET | `/.well-known/oauth-protected-resource` | RFC 9728 受保护资源元数据 |
| POST | `/api/import/url` | `{url}` 获取公开网页内容供客户端导入，返回 `{html,url}`；秀米阅读/预览链接返回其正文 HTML 而非页面壳 |

文稿有修订号 `meta.rev`；`PATCH /api/documents/:id` 可带 `baseRev`，与服务器不一致返回 409 `REV_CONFLICT`，不带则保持最后写入覆盖。成功的 PATCH 与 Agent 操作都会通过 `/live` 通知其他编辑器。`POST /api/documents` 返回的 `meta.rev` 从 1 开始。

未知 `/api/*` 返回 JSON 404，不回落到网页。团队隔离错误为 403，未登录为 401，未选团队为 409。模板目录公开可读；本地 Fastify 保持单用户开发模式。


四层接口共享同一套语义：**CLI 命令名 ≈ SDK 方法名 ≈ MCP 工具名 ≈ HTTP 路径**。
命名统一用「资源 + 动作」，避免三套词汇。

---

## 1. HTTP API（`apps/server`）

Base: `/api`。响应统一信封：

```jsonc
{ "ok": true, "data": { … }, "meta": { "count": 12, "cursor": null } }
{ "ok": false, "error": { "code": "TEMPLATE_NOT_FOUND", "message": "…", "details": {} } }
```

### 模板库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/rooms` | 分类树。`?house=paper&floor=comp` |
| GET | `/api/templates` | 列表。`?room=demo:header&q=标题&hasSvg=true&cursor=&limit=50` |
| GET | `/api/template?id=<atom_tpl_id>` | 单条完整记录（含 `matrix`、`html`） |
| GET | `/api/template/preview?id=<atom_tpl_id>` | 成品 HTML（`text/html`），素材重写为本地镜像 |
| GET | `/api/slots?id=<atom_tpl_id>` | 该模板可编辑的槽位列表 |
| GET | `/api/search?q=…` | 跨 room 全文检索（名称 + 文本内容） |
| GET | `/api/health` | 存活与数据目录 |

`atom_tpl_id` 含 `:` 与 `/`，放在 query 参数而非路径段，避免 `%2F` 被路由提前解码。

### 渲染与校验

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/render` | body: `{ document }` / `{ tplId, matrix, set }` / `{ matrix }`；`localAssets: true` 时把素材重写为 `/assets/*`；返回 `{ html, issues, bytes }` |
| POST | `/api/validate` | body: `{ html }`；返回 `{ issues }` |
| POST | `/api/fill` | body: `{ tplId, set: { txt1: "…" } }`；返回新的 `{ matrix, html }` |

`/api/render` 与 `/api/validate` **无状态、无副作用**，可安全重试。

### 账号

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me` | 当前会话 `{ user, loginEnabled, admin }`；未登录时 `user` 为 `null`；`admin` 表示站点管理员 |
| GET | `/auth/login?next=/…` | 跳转到账号服务，走授权码 + PKCE |
| GET | `/auth/callback` | 换取令牌，校验签名后写会话 cookie |
| GET | `/auth/logout` | 清会话后回到首页 |

会话存在 `HttpOnly` cookie 里，浏览器拿不到令牌。文稿按账号分开：未登录时文档接口返回
`401 LOGIN_REQUIRED`，登录后只能看到自己的。

### 文档

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/documents` | 列表（轻量，不含 blocks），仅限当前账号 |
| POST | `/api/documents` | 新建，body `{ title, blocks? }` |
| GET | `/api/documents/:id` | 完整文档 |
| PATCH | `/api/documents/:id` | 局部更新 `{ title?, blocks? }` |
| DELETE | `/api/documents/:id` | 删除 |
| POST | `/api/documents/:id/blocks` | 追加块 `{ kind, tplId?, matrix?, index? }` |

### 素材

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/assets/*` | 本地镜像素材（带 `ETag`，`immutable`） |
| GET | `/api/assets` | 镜像素材列表。`?q=&limit=&offset=` |
| GET | `/api/shop-image?url=…` | 店铺模板图片同源代理。只允许秀米/微信图片域名；服务端无 Referer 拉取后缓存，避免上游 403 |
| GET | `/uploads/*` | 上传图片访问 |
| GET | `/api/uploads` | 上传图片列表（按时间倒序） |
| POST | `/api/assets/upload` | `multipart/form-data` → `{ sha256, url, bytes }` |

### 微信同步

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/wechat/config` | 返回 `{ configured: boolean }`，不回传密钥 |
| POST | `/api/wechat/draft` | body `{ documentId, thumbMediaId?, author? }` → 创建草稿 |
| POST | `/api/wechat/material` | multipart 上传图片为永久素材，返回 `mediaId` + `url` |

错误码：`AUTH_REQUIRED` `TEMPLATE_NOT_FOUND` `DOCUMENT_NOT_FOUND` `INVALID_BODY`
`RENDER_FAILED` `WECHAT_NOT_CONFIGURED` `WECHAT_API_ERROR` `RATE_LIMITED`。

---

## 2. SDK（`@kiumi/sdk`）

```ts
import { createKiumi } from '@kiumi/sdk';

const kiumi = createKiumi({ dataDir: './data' });

// 模板库
const rooms = await kiumi.catalog.rooms({ house: 'paper', floor: 'comp' });
const page  = await kiumi.catalog.list({ room: 'demo:header', q: '标题', limit: 20 });
const tpl   = await kiumi.catalog.get('demo:header/t-a-01');

// 文档
const doc = kiumi.doc.create({ title: '晚餐食谱' });
doc.addBlock({ kind: 'library', tplId: 'demo:header/t-a-01' });
doc.fill(0, { txt1: '<p>一日三餐</p>' });

// 渲染
const { html, issues, bytes } = kiumi.render(doc.toJSON());
```

设计约束：

- `catalog` 全部 `async`（可来自文件或 HTTP）。
- `doc` 是纯同步的内存对象，`toJSON()` 可序列化，便于跨进程传递。
- `render` 纯函数：相同输入必须产出相同输出（golden-file 测试的基础）。

---

## 3. CLI（`kiumi`）

```
kiumi crawl templates [--house <h>] [--cookie <c>] [--public-only] [--no-skeletons] [--rps <n>]
kiumi crawl assets    [--concurrency <n>] [--rps <n>] [--limit <n>]
kiumi crawl all

kiumi crawl shop-list [--price all|free|paid] [--show-type paper|tablet] [--rps <n>] [--max-pages <n>] [--refresh]
kiumi crawl shop      [--scope free|owned|all] [--rights-confirmed] [--show-type paper|tablet]
                      [--offset <n>] [--max-items <n>] [--rps <n>] [--concurrency <n>]
                      [--force] [--no-index] [--shard <name>] [--merge]
kiumi crawl shop-assets [--concurrency <n>] [--rps <n>] [--budget-gb <n>]
                        [--offset <n>] [--limit <n>] [--manifest <path>] [--shard <name>]
kiumi shop localize
kiumi shop merge

kiumi stats [--json]
kiumi list  [--room <tag>] [--q <text>] [--has-svg] [--limit n] [--offset n] [--json]
kiumi show  <atom_tpl_id> [--html | --matrix | --json]

kiumi render <doc.json>  [-o out.html] [--pretty] [--json] [--no-validate]
kiumi render --tpl <atom_tpl_id> [--set txt1="…"] [-o out.html]
kiumi fill   <atom_tpl_id> --set txt1="…" --set img1.src="…" -o doc.json

kiumi md    <file.md> [-o doc.json] [--title <t>]
kiumi validate <file.html> [--json] [--max-bytes 20000]
```

服务端与前端不进 CLI，用根脚本启动：

```
pnpm serve          # 启动 HTTP API（默认 8787）
pnpm dev            # 同时起 API 与 Vite（5180）
```

通用约定：`--json` 输出机器可读；非零退出码表示失败；`--quiet` 关闭进度输出。

---

## 4. MCP 工具

本节是本地开发用的 stdio 版（`@kiumi/mcp`，读写本机目录）。生产的远程 MCP 工具集与授权见 [MCP.md](MCP.md)。

以 `stdio` 启动。工具按「只读 / 写入」分组，写工具在描述里显式标注。

| 工具 | 参数 | 说明 |
|---|---|---|
| `kiumi_list_rooms` | `house?`, `floor?` | 列出分类 |
| `kiumi_list_templates` | `room?`, `q?`, `hasSvg?`, `limit?` | 列出模板 |
| `kiumi_get_template` | `atomTplId` | 取单条（含 matrix） |
| `kiumi_search_templates` | `q`, `limit?` | 全文检索 |
| `kiumi_create_document` | `title` | 新建文档，返回 `documentId` |
| `kiumi_insert_template` | `documentId`, `atomTplId`, `index?`, `fill?` | 插入并可选填充 |
| `kiumi_fill_block` | `documentId`, `blockIndex`, `set` | 填充 slot |
| `kiumi_update_text` | `documentId`, `blockIndex`, `slot`, `text` | 改文字 |
| `kiumi_render_document` | `documentId` 或 `document` | 渲染为 HTML |
| `kiumi_validate_html` | `html` | 微信合规校验 |
| `kiumi_export_wechat_draft` | `documentId` | 推送草稿（需配置） |

返回统一为 `{ content: [{ type: 'text', text }] }`，结构化数据以 JSON 字符串承载，
便于模型直接读取字段；失败时 `isError: true` 且 `text` 为错误码 + 人类可读说明。

---

## 5. 错误码总表

| code | 含义 |
|---|---|
| `TEMPLATE_NOT_FOUND` | `atom_tpl_id` 不存在 |
| `SLOT_NOT_FOUND` | 填充的 slot 在该模板中不存在 |
| `SKELETON_MISSING` | `tplId` 找不到骨架 HTML |
| `RENDER_FAILED` | 渲染过程抛错（附 `details.stage`） |
| `INVALID_DOCUMENT` | 文档结构非法 |
| `AUTH_REQUIRED` | 需要登录态（抓取会员库时） |
| `WECHAT_NOT_CONFIGURED` | 缺少公众号凭证 |
| `WECHAT_API_ERROR` | 微信接口返回非 0 errcode |
| `RATE_LIMITED` | 本地限速器拒绝 |

## Word 导入与现有 API 的关系

DOCX/图片 ZIP 在浏览器解析，不新增 Word 转换 API，也不上传原始文档。图片确认后复用 `POST /api/assets/upload`（单张 10 MiB），浏览器另外限制图片总量 80 MiB。文稿沿用 `library` 块的 `html`、`tplId` 和 `matrix: []`，图片使用上传返回地址；保存、签名导出和公众号草稿沿用已有接口。详见 [Word 导入](WORD_IMPORT.md)。

## 模板本地缓存协议

- `GET /api/catalog/index`：完整公开模板目录，保留跨分类重复记录；客户端先按分类过滤，再按 atomTplId 去重。后台同步用此快照，避免逐页请求全库。
- `/api/catalog/index`、`/api/rooms`、`/api/templates`、`/api/template` 返回内容 ETag；`If-None-Match` 一致返回 304（兼容 Cloudflare 压缩后返回的 `W/` 弱 ETag）。底层数据服务读取仍受边缘缓存期限约束，更新不是实时推送。
- `GET /api/template?id=...&localAssets=true` 返回镜像素材地址的 HTML；不传参数保留原契约。缩略图和插入共用此记录。
- 编辑模式 `/api/render` 的 `localAssets:true` 接受内部 `/assets/`、`/uploads/` 地址；普通相对图片地址仍报错。复制/导出依旧生成绝对和签名链接。
- 图片上传按「团队 + 图片 SHA-256」生成稳定 ID，同一团队重复提交相同字节复用记录（保留第一次文件名）；不同团队不会共享资源权限，旧 UUID 图片继续可读。存储连接失败返回 503 `UPLOAD_UNAVAILABLE`，图库登记失败返回 503 `UPLOAD_INDEX_UNAVAILABLE`，上游拒绝写入返回 502 `UPLOAD_FAILED`。不需要数据库迁移。

## 图文设置元数据

现有团队文稿 create/PATCH 的 `meta` 可保存可选 `cover: string`（上传返回的封面地址）、`tags: string[]`，并继续使用 `author`、`digest`。不新增接口或迁移。公众号草稿调用仍通过现有独立 `cover` 字段传封面，UI 默认从文稿 meta 读取；标签不传给公众号。编辑工具栏保存普通 HTML/CSS 块，服务端继续使用原有清理、签名和校验流程。

## 文稿操作（ops）

`packages/core/src/docops.ts` 定义 Agent 与编辑器共用的修改描述，块以 id 寻址，可与本地编辑合并：

```jsonc
{ "op": "title", "title": "…" }
{ "op": "meta", "meta": { "digest": "…", "cover": "/uploads/…", "author": "…", "tags": [] } }
{ "op": "insert", "blocks": [ … ], "at": 0 | "end" | { "after": "<块id>" } }
{ "op": "replace", "id": "<块id>", "block": { … } }
{ "op": "html", "id": "<块id>", "html": "<p>…</p>" }
{ "op": "remove", "ids": ["…"] }
{ "op": "move", "id": "<块id>", "to": 2 }
{ "op": "set", "blocks": [ … ], "title": "…", "meta": { … } }   // 整体替换，导入与重新排版使用
```

任何一步失败整批不生效，返回 422 `OPS_FAILED`。`validateOps` 校验来自网络的操作。

## 团队排版规范

`GET/PUT /api/teams/typeset` 读写 `TypesetRules`（`bodySize`、`headingSize`、`headingBold`、`textColor`、`lineHeight`、`letterSpacing`、`paragraphGap`、`sidePadding`、`firstLineIndent`、`imageWidth`、`blankAroundImages`、`blankAtEdges`、`titleCutAtDelimiter`、`titleCommaToSpace`）。值在服务端按范围校验，非法值回落为默认。
