# API 契约

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
| GET | `/api/templates` | 列表。`?room=paper-cp:header&q=标题&hasSvg=true&cursor=&limit=50` |
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

### 文档

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/documents` | 列表（轻量，不含 blocks） |
| POST | `/api/documents` | 新建，body `{ title, blocks? }` |
| GET | `/api/documents/:id` | 完整文档 |
| PATCH | `/api/documents/:id` | 局部更新 `{ title?, blocks? }` |
| DELETE | `/api/documents/:id` | 删除 |
| POST | `/api/documents/:id/blocks` | 追加块 `{ kind, tplId?, matrix?, index? }` |

### 素材

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/assets/*` | 本地镜像素材（带 `ETag`，`immutable`） |
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
const page  = await kiumi.catalog.list({ room: 'paper-cp:header', q: '标题', limit: 20 });
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
kiumi crawl rooms   [--house paper] [--floor comp]
kiumi crawl templates [--room <tag>] [--include-obsolete] [--concurrency 2]
kiumi crawl pack    [--house paper]
kiumi crawl assets  [--from catalog] [--concurrency 4]
kiumi crawl all

kiumi list  [--room <tag>] [--q <text>] [--json]
kiumi show  <atom_tpl_id> [--html]

kiumi render <doc.json>  [-o out.html] [--wechat] [--pretty]
kiumi render --tpl <atom_tpl_id> [--set txt1="…"] [-o out.html]
kiumi fill   <atom_tpl_id> --set txt1="…" --set img1.src="…" -o doc.json

kiumi validate <file.html> [--json] [--max-bytes 20000]
kumi  export  <doc.json> -o out.html --mode wechat|plain

kiumi md <file.md> -o doc.json [--theme default]
kiumi serve [--port 5173]
```

通用约定：`--json` 输出机器可读；非零退出码表示失败；`--quiet` 关闭进度输出。

---

## 4. MCP 工具（`@kiumi/mcp`）

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
