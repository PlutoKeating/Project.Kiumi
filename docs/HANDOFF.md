# 交接说明

## 当前交付范围

Kiumi 是公开免费的桌面公众号排版工具。匿名用户可以浏览模板、排版和导出；登录后创建或加入团队，团队内共享文稿、图库和多个公众号。生产站点：https://kiumi.plutokeating.beer 。

用户已授权完成一批即提交并推送 main，及时部署生产。不要增加付费服务。正式发表在微信后台完成，本站链路止于创建草稿、回读核对和手机预览。

## 已实现

- OIDC 登录、创建/加入/切换团队、邀请与成员管理；生产用户已确认登录和创建团队正常。
- 团队隔离的文稿列表、打开、保存、删除；本地自动恢复与登录前草稿恢复。收藏、最近使用、块剪贴板仅本机保存。
- 自建磁盘图片上传与团队图库；模板目录只读。外部导出使用签名图片地址。
- 全量图文模板浏览、原始 HTML 编辑，文字、图片、颜色及 SVG 动画参数面板；不再依赖补齐每个骨架才能改字。失效素材在渲染中移除。
- 秀米「风格排版」店铺抓取：`crawl shop-list` 枚举列表（每页 72），`crawl shop` 读取公开预览页的 `showInfo.show_data_url`，把 `cubes[].pages[].layers[]._$raHTML` 落成模板记录并并入 `modern-index.json`；`shop merge` 可重复合并。
- Markdown、富文本、HTML 文件与公开网页导入。HTML 经 DOMPurify 与服务端清理；保留 SVG 动效。秀米预览/阅读链接由数据服务读取其 show-data 正文。
- 多选、批量复制/克隆/删除、撤销重做、缩放快捷键、Ctrl/Command+滚轮、拖动排序、Alt 拖入模板容器、格式刷。
- 团队公众号绑定，凭证 AES-GCM 加密入 D1；通过自建服务器固定出口上传正文图片/封面、创建草稿和回读。提交去重，正式发表不在本站执行。
- 模板列表在数据服务筛选分页，Worker 不再为一次列表请求读取整个索引。

## 架构与文件

浏览器 → Cloudflare Worker（网页、身份、团队 API）→ D1（团队/文稿/图库索引/加密公众号凭证/草稿任务）；Worker → VPC 隧道 → 自建 Node 数据服务（catalog/assets 只读，uploads 可写，微信固定出口代理）。

- `apps/edge/src/workspace.ts`：团队成员校验、文稿、上传与签名图片。
- `apps/edge/src/wechat.ts`：团队公众号、凭证加密、草稿任务去重。
- `deploy/ecs-data/wechat.mjs`：稳定 token、图片转换与上传、草稿创建及回读；`fetchPublic` 是带私网拦截和压缩解码的公开资源抓取。
- `deploy/ecs-data/import.mjs`：网页导入，识别秀米阅读页并取回正文 HTML；纯函数由 `deploy/ecs-data/test/` 的 `node --test` 覆盖。
- `apps/web/src/store.ts`：文稿、编辑历史、本地恢复、批量操作。
- `apps/web/src/components/MarkupEditor.tsx`：实际 DOM 与 SVG 编辑。
- `packages/core/src/html.ts`：HTML 清理、记录 HTML 的槽位同步、SVG ID 隔离。

模块说明见 `apps/web/docs/README.md`、`apps/edge/docs/README.md`；全局约定见 `ARCHITECTURE.md` 与 `API.md`。

## 启动与部署

使用 Node 22.6+、仓库指定的 pnpm。`pnpm install`、`pnpm dev` 提供本地模板/排版开发；完整团队链路运行于 Worker/D1，不等同于本地 Fastify API。

`pnpm typecheck`、`pnpm test`、`pnpm build:web` 做必要验证。`pnpm d1:schema` 应用生产增量迁移；不要向已有库重复执行完整 schema。`pnpm deploy` 生成本机部署配置、构建并部署 Worker。main 也触发 Git 集成。

数据服务改动需同步 `deploy/ecs-data` 的代码与依赖配置到既有数据机，再执行 `docker compose up -d --build`。模板与素材数据不进入 Git；所有密钥、部署编号、主机配置仅存在环境或忽略文件。

## 稿件导入、远程 MCP（2026-11-02）

已实现并有自动化覆盖：投递包 ZIP 一键排版、原图匹配、风格模板填充、团队排版规范、远程 MCP、文稿实时同步。设计见 [MANUSCRIPT.md](MANUSCRIPT.md) 与 [MCP.md](MCP.md)。

**上线情况（2026-11-03 已执行）：** D1 迁移 `0002` 已应用，Worker 已部署，数据服务已同步重建并用真实投递包验证（4.5 秒，4 张图全部高把握匹配），账号中心已登记 `kiumi-mcp`，`main` 已推送。下面的清单保留为自建或重做时的步骤：

1. `pnpm d1:schema` 应用 `0002_manuscripts.sql`，再部署 Worker（Durable Object `DocHub` 随 `wrangler.jsonc` 声明）。
2. 数据服务：同步 `deploy/ecs-data` 全目录（含 `core/`、`manuscript.mjs`），`docker compose up -d --build`；容器内存上限已提到 512 MB。
3. 账号中心登记公共客户端 `kiumi-mcp`（片段见 MCP.md），用真实 MCP 客户端走一遍登录与回调。
4. 建议：应用 `0003_settings.sql`，设置 `KIUMI_ADMIN_SUBS`，由管理员在 `/admin` 添加模型提供商与 Key（见 [MODELS.md](MODELS.md)）。网页导入用它复核结构并编排风格模板；没有模型时只用规则方案。

**尚未实测：** 真实 MCP 客户端经账号中心登录的完整授权流程（需要人用邮箱验证码登录一次）；真实公众号草稿经 MCP 同步；服务端 DOCX 提取（Agent 路径）比浏览器路径（Mammoth）覆盖的 Word 特性少，表格按纯文字，脚注、文本框、公式不导入，均在报告的 warnings 中说明。

## 验证与后续

当前类型检查与 15 个测试通过，包括真实 Miniflare D1 迁移、团队隔离、权限撤销、图片权限和草稿幂等。生产浏览器已验证导入、SVG 保留及文字修改，无页面脚本错误。

实际公众号凭证连接已成功，白名单已生效。用户已于本次交付中亲自确认：登录团队后，从网站编辑测试稿、保存、上传封面、同步草稿、在微信后台打开并发送手机预览，全部完成且没有错误。真实全链路验收通过。

若同步失败，先查看 `draft_jobs` 状态与微信错误。已获得草稿编号但回读失败时不要再次创建；在微信草稿箱确认。所有状态说明须区分本地测试、生产接口和手机实测。
