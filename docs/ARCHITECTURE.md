# 架构设计

## 1. 定位

Kiumi 是一个**公众号图文排版系统**：把「模板库 + 块编辑器 + 确定性渲染器 + 微信合规校验」做成一套
可在三种形态下复用的能力：

```
        ┌─────────────┐
        │   @kiumi/core     ← 唯一的真源：模型 / 渲染 / 校验
        └──────┬──────┘
      ┌────────┼─────────┬──────────┐
      │        │         │          │
   sdk      cli        mcp      server
      │        │         │          │
      └────────┴─────────┴──────────┘
                     │
                   web (React)
```

任何形态产出的 HTML 必须字节一致——因为渲染是**纯函数**，无浏览器依赖。

## 2. 仓库结构

```
packages/
  core/       模型、DSL、模板水合、渲染器、校验器、序列化     (无 IO，无网络)
  catalog/    抓取器、归一化、去重、素材镜像、manifest        (唯一做网络 IO 的地方)
  sdk/        面向调用的统一门面：catalog + doc + render      (被 cli/mcp/server 复用)
  cli/        kiumi 命令行
  mcp/        MCP server（stdio），暴露同一组能力
apps/
  server/     Fastify — HTTP API、素材代理、微信同步（数据落在 data/ 文件）
  web/        React 19 + Vite + Tailwind — 工作台
data/
  catalog/    归一化后的模板与组件（提交入库，体积小、可 diff）
  templates/  1,227 个模板骨架 HTML（提交入库）
  assets/     镜像素材（gitignore，由 `kiumi crawl assets` 复现）
  raw/        原始接口响应（gitignore，调试用）
docs/
```

依赖方向严格单向：`core ← catalog ← sdk ← {cli, mcp, server} ← web`。
`core` 永不 import `catalog`，`catalog` 永不 import `sdk`。

## 3. 数据流

```
rooms API ──┐
            ├─► normalize ──► dedupe(atom_tpl_id) ──► data/catalog/templates/*.json
rooms/{tag}─┘                                              │
                                                           ▼
tpl pack ──► $templateCache 解析 ──► data/templates/*.html  ──► SQLite (server 模式)
                                                           │
statics CDN ─► mirror(限速/重试/哈希) ──► data/assets/**    ▼
                                                    渲染 / 检索 / 编辑器
```

归一化产物分三层，避免「一份 JSON 既当索引又当正文」：

1. `templates/index.json` — 轻量索引（id / room / 名称 / 类型 / 是否 SVG / 时间），用于列表与搜索。
2. `templates/<slug>.json` — 单条完整记录（`matrix` + `renderer_accelerate` + 元数据）。
3. `templates/pack.json` — 骨架 HTML 的 `tplId → html` 映射。

## 4. 渲染：双路径

这是本项目最关键的设计判断。秀米的布局能力（嵌套 group、负 margin、绝对定位、SVG 内联）
用通用 CSS 引擎重写代价极高且难以 1:1。因此分两条路径：

### 路径 A：模板水合（保真，用于模板库内容）

```
matrix + 骨架 HTML  ──►  按 tn-bind-cell 定位节点  ──►  写入 slot 数据与内联样式  ──►  内联化  ──►  HTML
```

- 骨架已编码了秀米的布局意图，我们只做「填数 + 样式覆写」。
- 定位规则：`[tn-bind-cell="<slot>"]`，同名多节点按文档序配对。
- 样式覆写：`_comp.style` / `cell.style` 以 camelCase 展开为 CSS 属性，覆盖骨架原值。
- 兜底：若某 slot 在骨架中找不到绑定节点，则丢弃该 slot 并记录 `warnings`，绝不静默产出坏 HTML。

### 路径 B：自有渲染（用于用户新建内容）

自研块模型（`Block`）→ HTML，布局原语对齐秀米语义：

| 秀米原语 | 我方实现 |
|---|---|
| `group` (static) | `<ul><li>` 纵向流 |
| `group` (horizontal) | `<ul>` + `display:inline-block` + 百分比宽 |
| `text` | `<div><p>` 内联样式 |
| `image` | `<div><img>` + `max-width:100%` |
| `container` (absolute) | `<section>` + `position:relative/absolute` |
| `table` | `<table>` + 内联样式 |
| `shape` / divider | `<section>` 边框或背景 |

两条路径共享 `inline.ts`（class → 内联、样式规范化）和 `validate.ts`。

## 5. 微信合规校验

`validate.ts` 输出结构化 `Issue[]`（`error` / `warn` / `info`），规则：

| 规则 | 级别 |
|---|---|
| 含 `<script>` 或 `on*` 事件属性 | error |
| 含 `<style>` 或 `<link rel=stylesheet>` | error |
| 依赖 class 但无对应内联样式 | warn（微信会丢样式） |
| `height:0` 且不在 `<svg>` 容器内 | error（平台违规） |
| 外链相对路径图片 | error（微信不解析） |
| 正文字符数超阈值（默认 20000） | warn |
| `<svg>` 内使用 `<script>` / 外链 `<image href>` | error |
| 未闭合标签、嵌套非法 | error |

校验器基于 `parse5` 的容错解析，不依赖浏览器。

## 6. 文档模型（可编辑态）

```ts
interface Document {
  id: string;
  title: string;
  blocks: Block[];        // 顶层有序块
  meta: { theme?: string; createdAt: string; updatedAt: string };
}

type Block =
  | { kind: 'library'; tplId: string; matrix: MatrixTree; overrides?: Record<string, unknown> }
  | { kind: 'native';  comp: Comp };
```

- `library` 块保留原始 `matrix`，编辑即改写 matrix，渲染走路径 A。
- `native` 块是我们自建的块，渲染走路径 B。
- 二者可混排：文档渲染时按序拼接，块间不共享状态。

## 7. 存储

**文件优先**。catalog 是 3,927 条结构化 JSON，文件布局天然可 diff、可 grep、可离线；
在这个量级下数据库是纯负担，因此本期不引入 SQLite/ORM。

```
data/catalog/rooms.json          分类
data/catalog/index.json          轻量索引（列表与筛选）
data/catalog/templates/<slug>.json   单条矩阵 + 成品 HTML
data/catalog/pack.json           tplId -> 骨架 HTML
data/catalog/assets-manifest.json 远端 URL -> 本地路径 + sha256（随镜像生成，已 ignore）
data/documents/<id>.json         用户文档
data/uploads/<sha256>.<ext>      上传图片
```

检索目前是「索引过滤 + 按需全量加载」：3,927 条全量读入约 0.3 秒，足够单人使用。
当需要并发多用户或模糊排序时，再引入 SQLite FTS5（`node:sqlite` 内置，无需原生依赖），
届时 `catalog` 作为唯一写入口、数据库作为派生索引。

`matrix` 与 `html` 双存：`html` 用于缩略与快速取用，`matrix` 用于编辑。

## 8. HTTP API（server）

见 `docs/API.md`。要点：

- 读接口全部幂等、可缓存（`ETag`）。
- 渲染接口 `POST /api/render` 接收文档或 matrix，返回 HTML + issues，**无状态**。
- 素材走 `/assets/*` 本地代理，避免前端受 CDN 地域/防盗链影响。
- 微信同步 `POST /api/wechat/sync` 需要 `appId/appSecret`，凭证仅存服务端 `.env`。

## 9. 关键决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 以接口返回为真源，源文件包为补充 | 接口是超集（多 23 个 tplId） |
| D2 | 渲染不用浏览器 | 可做 golden-file 测试、可跑在 CLI/MCP、毫秒级 |
| D3 | 双路径渲染 | 保真与可扩展不能同时由一套引擎满足 |
| D4 | `data/assets` 不入库 | 300MB 级二进制进 git 会毁掉仓库；用 manifest + 命令复现 |
| D5 | 文件优先，暂不引入数据库 | 3,927 条结构化 JSON 用文件即可；需要全文检索时再上 `node:sqlite` |
| D8 | 素材重写发生在渲染期 | 记录里保留原始绝对 URL，导出到微信仍可直连；画布预览才换成本地镜像 |
| D6 | MCP 与 CLI 共用 sdk | 一处实现，两处暴露，避免语义漂移 |
| D7 | 前端自有视觉 | 用户拍板：功能对等，视觉不抄 |
