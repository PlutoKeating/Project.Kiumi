# 秀米（XIUMI）平台逆向报告

本文记录对 `xiumi.us` 图文编辑器（studio v5）的实测逆向结论。所有端点均在 2026-10-29 实测。
结论用于项目的数据摄入与模型设计，不代表对源站内容的再分发授权。

---

## 1. 前端形态

- SPA，AngularJS 1.x（`ngRoute` + 自研 `tn-*` 指令集），非 React/Vue。
- 入口：`https://xiumi.us/studio/v5`，编辑器主包：
  - `//edt.xiumius.cn/scripts/app/studio/entries/total/<hash>.main.min.js`（约 9.6 MB）
  - `//edt.xiumius.cn/styles/app/studio/<hash>.index.min.css`（约 1.9 MB，433 个 `tn-*` 选择器）
- 模板内容包（Angular `$templateCache`）：`https://xiumi.us/template/v5/<house>/comp/ng-tpl.js?host=xiumi.us`
- 渲染与编辑的临时态由 `tn-` 前缀的 class + 内联样式表达；class 仅用于编辑器选区高亮，**成品样式全部内联**，这正是能粘贴进微信后台的原因。

## 2. 数据源（全部实测）

### 2.1 模板分类树（公开，无需登录）

```
GET  /api/templates/{house}/{floor}/rooms
GET  /api/templates/{house}/{floor}/rooms/{urlencode(tag)}
```

已确认可用的 `house/floor` 组合：

| house/floor | rooms | 说明 |
|---|---|---|
| `paper/comp` | 23 | 图文模板组件库（主体） |
| `paper/page` | 0 | 整篇图文，当前为空 |
| `booklet/comp` | 10 | H5（翻页）组件 |
| `booklet/page` | 10 | H5 整篇 |

`paper/comp` 的 23 个 room（`tag` / `name`）：

| tag | name |
|---|---|
| `paper-cp:recent` | 新模板 |
| `paper-cp:header` | 标题 |
| `paper-cp:image` | 单图 |
| `paper-cp:multi-pic` | 多图 |
| `paper-cp:layout-background` | 背景图 |
| `paper-cp:card` | 卡片 |
| `paper-cp:separator-line` | 分割线 |
| `paper-cp:top-bottom-guide` | 关注和原文 |
| `paper-cp:layout` | 布局 |
| `paper-cp:layout-samples` | 组合 |
| `paper-cp:table` | 表格 |
| `paper-cp:element` | 零件 |
| `paper-cp:sticker` | 贴纸 |
| `paper-cp:SVG` | SVG 贴纸 |
| `paper-cp:video` | 视频 |
| `paper-cp:chatbox` | 对话/问答 |
| `paper-cp:sync-only` | 同步专属 |
| `paper-cp:vertical-align` | 竖排 |
| `paper-cp:namecard` | 名片 |
| `paper-cp:slider` | 滑动 |
| `paper-cp:form` | 表单组件 |
| `paper-cp:wechat` | 微信 UI |
| `paper-cp:timeline` | 轴线系列 |

### 2.2 模板条目结构

`rooms/{tag}` 返回 `data.items[]`，单条字段：

```jsonc
{
  "template_id": 112,
  "atom_tpl_id": "paper-cp:header/1-txt-normal",   // 全局唯一标识
  "display_name": "文字",
  "creator_id": 21,
  "category": "paper-cp",
  "accessibility": "Public" | "Obsolete",
  "visibility": "All",
  "feature_requires": [],        // 公开库实测为空
  "order_num": 20,
  "version": 5,
  "level": "1",                  // 公开库实测恒为 1（免费层）
  "level_remain_life": "0",
  "created_at": "...", "updated_at": "...",
  "renderer_accelerate": "<div class=\"tn-comp-anim-pin ...\">…</div>",  // 成品 HTML
  "matrix": { "_comp": { … }, "<slot>": { … } }                        // 结构化模型
}
```

`renderer_accelerate` 与 `matrix` 是同一份内容的两种投影，互为校验依据。

### 2.3 模板源文件

`//sd.xiumius.cn/tpls/<category>/<date-or-type>/<n>.html`，共 **1,227** 个，
已全量内联进 `ng-tpl.js` 的 `$templateCache.put('url', 'html')`，无需逐个回源。

命名：`paper-cp/{header,card,image,layout,other,middleware}` 为语义目录，
`paper-cp/2016-3-30/14` 这类为按日期归档的历史目录。

### 2.4 静态素材

- `//statics.xiumi.us/stc/images/**` — 模板配图、图标、SVG 贴纸
- `//statics.xiumi.us/mat/i/**` — 素材库
- 全库实测去重后 **1,593** 个资源 URL。

### 2.5 需登录的接口（本期通过注入 Cookie 抓取）

| 端点 | 用途 | 未登录响应 |
|---|---|---|
| `GET /api/fragments/v5/{a}/{b}/tags` | 片段/模板标签 | 401 `Auth:Failed_NotLogin` |
| `GET /api/templates/items?atom_tpl_id=…` | 模板条目详情 | 可用 |
| `POST /api/assets/image/svgContent` | SVG 上传/托管 | 401 |
| `GET /api/templates/{house}/{floor}/rooms`（会员 house） | 会员库 | 400 InvalidParam |

截图 SVG 菜单的 28 类动效（点击展开 / 路径动画 / 转场 / 抽签 …）属于会员侧，
公开库中的 `paper-cp:SVG` 仅为「可换色矢量贴纸」。抓取策略见 `docs/DEVELOPMENT_PLAN.md` 的 M2。

## 3. 块模型（`matrix`）

递归树。每个节点是一个 `comp`：`_comp` 元数据 + 若干命名 slot（`txt1` / `img1` / `col1` / `r2c1` …）。

```ts
type CellType = 'text' | 'group' | 'image' | 'video' | 'shape' | 'table' | 'container';

interface CompMeta {
  tplId: string;                       // 指向 templates/ 下的骨架
  constraint?: {
    pose?: { resize?: 'h' | 'w' | 'both' };
    opMenu?: Record<string, boolean>;  // 编辑期可用的操作项
    childLayout?: 'static' | 'absolute';
  };
  pose?: { width?: string | null; height?: string | null; position?: 'static' | 'absolute' | 'relative' };
  style?: Record<string, string | null>;   // textAlign/fontSize/margin/transform/backgroundImage/…
  link?: string | null;
  linkFrame?: boolean;
  anim?: unknown | null;                   // SVG 动画描述
}

interface Cell {
  type: CellType;
  style?: Record<string, string | null>;
  items?: Comp[];        // type=group 时
  text?: string;         // type=text 时（HTML 片段）
  src?: string;          // type=image 时
  [k: string]: unknown;  // 其余按类型扩展
}
```

实测规模：980 个唯一 `tplId`，其中 23 个不在公开源文件包内（仅存在于接口返回），
说明接口是源文件包的超集，**以接口为准、源文件包为补充**。

## 4. 模板 DSL

模板骨架 HTML 上的指令属性（实测计数）：

| 属性 | 次数 | 语义 |
|---|---|---|
| `tn-bind-cell` | 1431 | 声明该 DOM 元素承载某个 slot 的数据 |
| `tn-cell-type` | 1431 | slot 类型：text 718 / group 500 / image 80 / video 3 / shape 1 / table 1 / container 1 |
| `tn-bind-aux-prop` | 3095 | 编辑器辅助属性绑定，如 `{ backgroundColor: compAux.titleBgc }` |
| `tn-sub-comp-loader` | 502 | 嵌套投放区（子组件挂载点） |
| `tn-child-position` | 503 | `static` / `absolute` 布局语义 |
| `tn-child-orientation` / `tn-horizontal-layout-width` | 8 / 2 | 横竖排 |
| `tn-svg-animation` / `-style` / `-carousel` | 2 / 1 / 1 | SVG 动画 |
| `tn-video` / `tn-mini-program` | 3 / 1 | 视频卡、小程序卡 |
| `tn-input-radio-*` / `tn-input-checkbox-*` | 各 7 | 表单控件 |
| `tn-group-usage` / `tn-container-usage` / `tn-sortable-pin` | 2 / 1 / 1 | 容器语义 |

## 5. 渲染约束（微信侧）

- 微信图文只保留**内联样式**；`class` 会保留但没有样式表，因此任何依赖 class 的样式都会失效。
- 不允许 `<script>`、事件属性、外链 CSS。
- `height: 0` 在普通元素视为违规排版，但在 **SVG 交互容器内是官方允许的**（用于点击展开）。
- 字符数上限对含内联 SVG 的长图文很敏感，展开型 SVG 会显著增大正文体积。
- 企业号后台不支持 SVG，会丢图。

→ 渲染器必须做到「class 归零、样式全部内联、结构可静态校验」。

## 6. 二次开发可用性评估

| 能力 | 结论 |
|---|---|
| 模板全量获取 | ✅ 公开接口可拿，无需登录 |
| 模板结构与成品 HTML | ✅ 双投影齐全，可做保真渲染 |
| 素材镜像 | ✅ 公开 CDN |
| 编辑器交互复刻 | ⚠️ 需自建；无开源先例可抄 |
| 高级 SVG 动效 | ⚠️ 会员侧，需 Cookie；动效语义需自研 DSL |
| 微信草稿箱同步 | ⚠️ 需公众号 AppID/AppSecret 与 IP 白名单 |
| 账号/团队/评论 | ⚠️ 需自建 |

## 7. 合规与工程约束

- 抓取需限速（默认 2 请求/秒，可配），失败指数退避，不并发轰炸。
- 所有条目保留 `atom_tpl_id`、`creator_id`、`source`、`fetched_at` 作为来源标注，不做「洗掉出处」。
- 登录凭证只从环境变量/本地 `.env` 读取，**永不写入仓库、永不进入日志**。
- 会员标注（`accessibility` / `level`）原样保留，供前端做可见性裁决。
