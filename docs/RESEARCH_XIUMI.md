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

### 2.4.1 线上标签体系（登录后可见，权威来源）

编辑器实际使用的不是 `rooms` 接口，而是标签树 + 标签列表：

```
GET /api/templates/tags_tree?tag_category=paper-cp&tag_level_from=2&tag_level_to=0&template=false
GET /api/templates?tag_ids=<id>&tag_category=paper-cp&match_level=default
                     &template_category=paper-cp&limit=100&offset=0
GET /api/templates/items?atom_tpl_id=<id>[&atom_tpl_id=...]
```

`tags_tree` 返回三级结构，与界面的菜单一一对应：

| 一级 | 二级（叶子） |
|---|---|
| 标题 | 基础/极简/框线/图片/底色/符号/主副/编号/竖排/渐变/动态/文字纹理/文字阴影 |
| 卡片 | 基础/极简/纯文字/框线/底色/底纹/图文/对话问答/轴线 |
| 图片 | 基础/纯图片/单图/双图/三图/四图/多图/圆形图/背景图/滑动图片 |
| 布局 | 基础/表格/左右图文/上下图文/上下滑动/左右滑动/自由布局/组合 |
| SVG | 基础 SVG/图片轮播/点击展开/路径动画/抽签/趣味滑动/轮换转场/分支转场/滑动触发/视差移动/点击切换/翻页翻转/缩放/点击答题/文字弹幕/点击显示/点击换图/点击打开/点击消失/点击弹出/点击放大/点击打印/点击跳转/点击播放/长按切换/区域触发/点击掉落/点击+自动 |
| 组件 | 分割线/分隔符/公众号组件/引导关注/二维码/文末互动/零件/视频/表单 |
| 热门 | 简约/节气/秋天/校园/党政/商务/电商/体育/美食/健康/卡通/万圣节 |

共 **89 个叶子标签**。标签列表接口一次返回完整记录（含 `matrix` 与 `renderer_accelerate`），
分页参数是 `limit` / `offset`。

实测全量：**52,040 次拉取 → 21,817 条唯一模板 → 136 MB HTML**，0 错误。

### 2.4.2 SVG 动效是渲染期合成的

现代 SVG 模板的 `matrix` 里没有最终 `<svg>` 标记，只有 `svg-layout` 容器与
`Fade` / `Expand` 等动画描述符（cell `type` 直接是动画名）。真正的 SVG 由官方引擎在渲染时合成。

因此本项目对这类模板采用保真兜底：矩阵渲染若丢失 `<svg>`，直接回用官方成品 HTML，
并给出 `SVG_ENGINE_FALLBACK` 警告。实测输出与上游逐字节一致（14,918 B，4 个 `<svg>`、6 个 `animate`）。

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

## 6.1 渲染适配结论（全库实测）

抓取到的 3,927 条模板分三个 house，渲染可行性不同：

| house | 条数 | 作为公众号正文渲染 | 说明 |
|---|---|---|---|
| `paper-cp` | 3,228 | ✅ | 图文正文，唯一目标形态 |
| `booklet-cp` | 146 | ✅ | H5 组件，结构同样是块树 |
| `booklet-pg` | 553 | ❌ | H5 整页，靠 `tn-layer` 绝对定位分层，不是文章流 |

`paper-cp` 全量渲染结果：0 崩溃、0 未展开投放点，字节量为上游成品 85%（差在 class 与颜色写法）。
唯一 19 条报错来自 `paper-cp:form/*` 表单组件——它们输出 `<input>`，而微信正文会剥离表单元素。
表单类模板正确用途是 H5，不是图文，校验器报错即为预期行为。

`booklet-pg` 用矩阵无法识别（根 `tplId` 是 `booklet-cp:sys/pg-fs`），只能在 catalog 的 room 上区分，
因此判断放在 SDK/CLI 层，而不是渲染器里。

## 7. 合规与工程约束

- 抓取需限速（默认 2 请求/秒，可配），失败指数退避，不并发轰炸。
- 所有条目保留 `atom_tpl_id`、`creator_id`、`source`、`fetched_at` 作为来源标注，不做「洗掉出处」。
- 登录凭证只从环境变量/本地 `.env` 读取，**永不写入仓库、永不进入日志**。
- 会员标注（`accessibility` / `level`）原样保留，供前端做可见性裁决。
