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

### M0 · 骨架与文档 — ✅ 完成

- [x] 五份文档（逆向报告 / 架构 / API / 计划 / 快速开始）
- [x] pnpm workspaces + tsconfig + 根脚本
- [x] `pnpm -r typecheck` 零错误、首次提交

### M1 · 数据摄入 — ✅ 完成

- [x] 房间发现 → 全室抓取 → 按 `atom_tpl_id` 去重
- [x] `$templateCache` 解析 → `data/catalog/pack.json`（1,360 个骨架）
- [x] 素材清单 + 镜像（限速/重试/哈希/可续跑）
- [x] 实测结果：**3,927 模板 / 43 分类 / 1,360 骨架 / 0 失败**

### M2 · 会员库抓取 — ⏸ 待凭证

- [x] `--cookie` / `XIUMI_COOKIE` 注入通道
- [x] 未登录端点返回 401 时记录原因、不中断
- [ ] 实际抓取会员 house 与 `/api/fragments/v5/*`（需用户提供 Cookie）

### M3 · 渲染引擎 — ✅ 完成

- [x] `model` / `dsl` / `style` / `pack` / `hydrate` / `blocks` / `validate`
- [x] 全库 3,927 条压测：0 崩溃；`paper-cp` 3,228 条 0 校验错误，字节量为上游 85%
- [x] SVG 贴纸内联为 `<svg>`（与上游一致），保证换色与动效可用
- [x] `booklet-pg` 553 条标记为 H5 整页、不参与正文渲染（见逆向报告 6.1）
- [x] 6 个单测（水合、嵌套展开、确定性、校验规则、原生块、真实样本）

### M4 · CLI + SDK + MCP — ✅ 完成

- [x] `kiumi crawl|stats|list|show|render|fill|validate`
- [x] `@kiumi/sdk` 统一门面 + 文件文档仓库
- [x] MCP 13 个工具，stdio 冒烟测试通过
- [x] `kiumi md`（Markdown → 文档 JSON），零依赖解析标题/列表/引用/代码/图片

### M5 · 服务端 — ✅ 完成

- [x] Fastify：catalog / template / render / validate / fill / documents / assets / wechat
- [x] 素材本地代理 + 上传
- [x] 微信 access_token 缓存、草稿箱、永久素材
- [x] 实测：`rooms` / `templates` / `template` / `render` / `wechat/config` 均通

### M6 · 前端工作台 — ✅ 主流程完成（格式刷待补）

- [x] 左侧轨道 + 顶部 Tab + 悬停分类菜单
- [x] 模板卡实时预览（iframe 直出成品 HTML）
- [x] 点击插入、画布选中、结构列表、上下移动、删除
- [x] 右侧槽位编辑（文字 / 图片）、实时重渲染、校验问题展示
- [x] 顶部工具条：标题 / 正文 / 图片 / 分割线 / 间距 / 上传图片
- [x] 预览弹窗、复制富文本、导出 HTML
- [x] 图片素材面板：按文件名搜索、缩略图网格、点击插入
- [x] 撤销/重做（最近 50 步，Cmd/Ctrl+Z）
- [x] 收藏、剪贴板、我的图库三个面板
- [x] 结构列表拖拽排序（原生 drag 事件，无新依赖）
- [ ] 跨容器移动、格式刷

### M7 · 微信直连与打包 — 🟡 打包已验证，微信待联调

- [x] 草稿箱 API、图片永久素材、凭证只读环境变量
- [x] Dockerfile ×2 + docker-compose + nginx 反代
- [x] `docker compose up` 实测：镜像构建通过，工作台/API/代理全部可用
- [ ] 用真实测试号跑通草稿箱推送（需要 AppID/Secret 与 IP 白名单）

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
