# 开发计划

> 本文件是项目唯一的工作基线。范围、决策、验收标准都以此为准。
> 任何偏离请先改本文件，再改代码。

---

## 0. 决策记录

### 0.1 已拍板（用户明确选择）

| # | 决策 | 选择 |
|---|---|---|
| D-01 | 抓取范围 | **全量镜像含归档**，并**加登录态抓会员库**：能拿到的全部下载存档 |
| D-02 | 技术栈 | **TypeScript Monorepo**（pnpm workspaces） |
| D-03 | 产品边界 | **内容生产闭环 + 微信直连**（草稿箱同步） |
| D-04 | 前端口径 | **功能复刻，自有视觉**（不抄像素，交互对等） |

### 0.2 采用默认值（用户未反对，视为通过）

| # | 问题 | 默认值 |
|---|---|---|
| D-05 | 会员/SVG 动效库抓取方式 | 抓取器支持 `--cookie` 注入；凭证只从 `.env` / 环境变量读取，**永不入库**；无凭证时该阶段跳过并记录 |
| D-06 | 数据存储 | SQLite + Drizzle，schema 兼容 Postgres |
| D-07 | 素材落地 | 全量镜像到 `data/assets/`（gitignore），catalog 中 URL 重写为本地路径 |
| D-08 | 图片上传 | 本地磁盘 `${DATA_DIR}/uploads`，抽象成 `AssetStore` 接口，后续可换 S3/MinIO |
| D-09 | 账号体系 | 单用户本地模式，无登录页；预留 `userId` 字段 |
| D-10 | Markdown 导入 | 实现 `kiumi md`，输出块模型 JSON（复用 doocs/md 的主题思路，不自建语法树） |
| D-11 | 许可证 | MIT |
| D-12 | 部署 | Docker Compose（`server` + `web` + 卷挂载 `data/`），并提供裸机 `kiumi serve` |
| D-13 | 测试 | golden-file 渲染快照 + 抓取幂等测试 + 校验器规则单测 |
| D-14 | 品牌 | 项目名 **Kiumi**；UI 不出现 XIUMI 名称与 Logo；数据源标注保留在 catalog 元数据中 |
| D-15 | 字体 | 秀米的 `tnYzkFontUsageId`（有字库 webfont）在微信不可用；默认降级系统字体，提供可选「文字转图」开关 |
| D-16 | 编辑器交互 | **点击插入为主**（对齐秀米心智），拖拽用于排序与跨容器移动 |
| D-17 | H5/booklet 范围 | 本期只做图文（`paper`）；`booklet` 仅抓取存档，编辑器不支持翻页稿 |
| D-18 | 抓取合规 | 限速 2 req/s、指数退避、保留 `source/fetched_at/creator_id` 来源标注、不提供公开再分发端点 |

---

## 1. 里程碑

每个里程碑都有可执行的验收命令。**未通过验收不得进入下一里程碑。**

### M0 · 骨架与文档 — 本次交付

- [x] `docs/RESEARCH_XIUMI.md` 逆向报告
- [x] `docs/ARCHITECTURE.md`
- [x] `docs/API.md`
- [x] `docs/DEVELOPMENT_PLAN.md`
- [x] pnpm workspaces + tsconfig + 根脚本
- [ ] `pnpm -r typecheck` 通过
- [ ] 首次 git 提交

**验收**：`pnpm install && pnpm -r typecheck` 零错误。

### M1 · 数据摄入（`@kiumi/catalog`）

- 房间发现 → 全室抓取 → 按 `atom_tpl_id` 去重
- `$templateCache` 解析 → `data/templates/**`
- 素材清单 + 镜像（限速/重试/哈希/断点续传）
- 产出：`index.json` / `templates/*.json` / `pack.json` / `assets-manifest.json`

**验收**：
```bash
kiumi crawl all --limit 0
kiumi stats            # 期望：≥2400 模板, ≥1200 骨架, ≥1500 素材
kiumi crawl templates  # 第二次运行应全部命中缓存，0 次网络请求
```

### M2 · 会员库抓取（依赖凭证）

- `--cookie` / `XIUMI_COOKIE` 注入
- 探测并抓取 `/api/fragments/v5/*`、会员 house
- 抓不到的端点记录到 `data/crawl-report.json`，不静默失败

**验收**：有凭证时 VIP 条目数 > 0；无凭证时报告明确写出「跳过原因」。

### M3 · 渲染引擎（`@kiumi/core`）

- `model.ts` 类型 + `dsl.ts` 常量
- `hydrate.ts` 模板水合（路径 A）
- `blocks.ts` 自有渲染（路径 B）
- `inline.ts` 样式内联与归一化
- `validate.ts` 微信合规规则

**验收**：
```bash
kiumi render --tpl demo:header/t-a-01 -o /tmp/a.html
# 1) 体量与原 renderer_accelerate 同数量级（±5%）
# 2) validate 输出 0 error
# 3) 20 个抽样模板的 golden 快照全部稳定（二次运行 diff 为空）
```

### M4 · CLI + SDK + MCP

- 全部命令按 `docs/API.md` 实现
- MCP 12 个工具可被任意 MCP 客户端发现与调用

**验收**：
```bash
kiumi md README.md -o /tmp/doc.json && kiumi render /tmp/doc.json -o /tmp/doc.html
npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js   # 工具列表齐全
```

### M5 · 服务端（`apps/server`）

- Fastify + Drizzle + SQLite；catalog 入库
- `/api/render` `/api/validate` `/api/templates*` `/api/documents*` `/assets/*`
- 素材上传、微信草稿同步

**验收**：`curl` 全量打通 `docs/API.md` 的每个端点；渲染接口 P95 < 50ms（本地）。

### M6 · 前端工作台（`apps/web`）

对标秀米的核心交互（自有视觉）：

1. 左侧轨道：图文模板 / 图片素材 / 收藏 / 剪贴板 / 我的图库
2. 顶部 Tab + 悬停巨型菜单：标题 / 卡片 / 图片 / 布局 / SVG / 组件 / 热门
3. 模板卡点击 → 插入画布光标处
4. 画布：块选中、右键菜单、拖拽排序、跨容器移动
5. 右侧：块属性面板（文字/颜色/间距/图片/链接/动画）
6. 顶部工具条：字号、颜色、对齐、行距、字距、格式刷、撤销重做
7. 预览（手机框）+ 一键复制到微信 + 导出 HTML

**验收**：从空白到一篇 5 段图文（含标题、卡片、分割线、图片）全流程可用；
复制到微信后台后样式不丢失（人工核对）；工具栏 12 项格式操作生效。

### M7 · 微信直连 + 打包

- 公众号草稿箱 API（`cgi-bin/draft/add`）、图片永久素材
- Docker Compose、`kiumi serve`
- README 完整使用说明

**验收**：配置测试号后 `kiumi export --wechat` 能在后台看到草稿。

---

## 2. 交付物清单

| 类型 | 产物 |
|---|---|
| 数据 | 2,426 模板 / 1,227 骨架 / 1,593 素材 / 980 tplId 映射 |
| 库 | `@kiumi/core` `@kiumi/catalog` `@kiumi/sdk` |
| 工具 | `kiumi` CLI（12 命令）、`@kiumi/mcp`（12 工具） |
| 服务 | HTTP API（18 端点） |
| 界面 | React 工作台（7 个功能域） |
| 文档 | 本目录 5 份 + README |

---

## 3. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 源站接口变更 | 抓取失效 | 抓取器按 `house/floor/room` 解耦；失败写报告；catalog 已落盘可离线工作 |
| 会员库无凭证 | 高级 SVG 动效缺失 | 公开库 214 个含 SVG 模板可用；自研 SVG 动效 DSL 作为兜底（M3 之后追加） |
| 模板矩阵存在未覆盖 slot | 渲染出坏 HTML | 水合失败即丢弃 slot + `warnings`，绝不静默；校验器兜底拦截 |
| 内联 SVG 撑大正文 | 超微信字数限制 | 校验器统计字节数；提供「SVG 转图」降级开关 |
| 微信样式清洗策略变化 | 粘贴掉样式 | 校验器规则集中可调；保持 `renderer_accelerate` 原始输出可对比 |
| 素材体积 | 仓库膨胀 | `data/assets` gitignore + manifest 复现 |
| 版权/合规 | 法律风险 | 仅本地存档与自用；保留来源标注；不提供公开模板再分发接口；凭证不入库 |

---

## 4. 命令速查

```bash
pnpm install
pnpm -r typecheck
pnpm -r build

pnpm kiumi crawl all          # 全量抓取
pnpm kiumi stats              # 统计
pnpm kiumi list --room paper-cp:header --q 标题
pnpm kiumi render --tpl demo:header/t-a-01 -o out.html
pnpm kiumi validate out.html
pnpm kiumi serve              # 起 API
pnpm --filter @kiumi/web dev  # 起前端
```

---

## 5. Definition of Done

一个功能算「完成」需同时满足：

1. 类型检查零错误（`pnpm -r typecheck`）
2. 有可执行验收命令并已跑通
3. 渲染类改动附 golden 快照
4. 文档（README / ARCHITECTURE / API）与代码一致
5. 已本地提交，工作区无未跟踪文件
