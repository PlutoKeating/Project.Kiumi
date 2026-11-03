# 架构

Kiumi 面向公众号图文制作，使用 TypeScript monorepo。只支持桌面浏览器；不建设 H5 表单或移动端编辑器。

## 运行拓扑

浏览器 React 工作台 → Cloudflare Worker（静态网页、OIDC、团队 API）→ D1（团队、成员、文稿、图库元数据）。
Worker 通过 VPC/Tunnel 连接自建数据服务。模板与镜像素材目录只读，用户上传独立目录可写。所有图片本体存自建服务器，不使用 R2。

## 模块

- `packages/core`：纯函数文档模型、模板水合、原始 HTML 保真编辑、清理和微信校验；另有稿件语义模型与结构识别、风格模板分析与填充、原图匹配、团队排版规范与检查、DOM 无关的 DOCX 段落提取、文稿操作（ops）。这些模块不依赖浏览器，网页、Worker、数据服务与测试共用。
- `packages/catalog`：来源数据抓取、归一化、素材镜像与目录索引；内置模板走 `crawl templates` / `crawl tags`，秀米「风格排版」店铺走 `crawl shop-list` / `crawl shop`，店铺记录并入 `catalog/modern/` 与 `modern-index.json`，分类为「风格排版」。店铺单条引用几十张图，首轮不逐张镜像，由 `/api/shop-image` 同源代理并在边缘缓存；后续可分批镜像。
- `packages/sdk`：文件目录和文档操作门面；CLI、MCP、本地 Fastify 服务复用。
- `apps/edge`：生产 HTTP API，依赖 core 与 D1/数据服务适配器。
- `apps/web`：React + Zustand 工作台，core 在浏览器同步渲染；公开模板通过 Cache Storage 持久缓存，团队数据通过 HTTP 调用 Worker。
- `deploy/ecs-data`：私网 HTTP 服务，持久化目录由 Docker 卷挂载；处理稿件 ZIP（解压、读 Word、sharp 匹配并缩放原图），所需的 core 模块以 `deploy/ecs-data/core/` 同步副本随目录部署（`pnpm sync:ecs-core`，测试检查不漂移）。

## 团队与数据边界

用户通过现有 OIDC 账号登录，可创建或加入多个团队。创建者管理邀请码和成员。成员共享团队文稿、图库及团队公众号。每个团队请求都验证成员关系，不能仅信任客户端团队编号。

文稿使用 D1 存储 blocks 与 meta；旧个人文稿在创建团队时迁移归属。本地恢复副本按账号和团队分开；不保存历史版本，不实现实时协同。收藏、最近使用、块剪贴板仅在浏览器保存。

原始上传图片需要成员身份；导出时生成可供微信读取的签名地址。图片写入先完成文件存储再登记 D1。

## 稿件导入、MCP 与实时同步

`docs/MANUSCRIPT.md` 描述从「Word + 原图」到套好风格图文的流水线；`docs/MCP.md` 描述 Agent 入口。要点：

- Worker 对外提供 `/mcp`（Streamable HTTP，OAuth 令牌来自账号中心，RFC 9728 元数据）。`currentUser` 对带 `Authorization` 的请求只认 Bearer 令牌，对浏览器仍用会话 Cookie。
- 文稿有修订号 `rev`（D1 `documents.rev`）。所有写入（网页保存、Agent 操作）都使其加一；网页保存携带 `baseRev`，落后即 409。
- 每个打开的文稿对应一个 Durable Object（`DocHub`，只转发通知，不存文稿）。写入后 Worker 推送 `{rev, by, from, ops}`，编辑器按同一份 ops 在本地应用，作为一步可撤销的修改。
- 导入大文件走预签名上传地址：Worker 把请求体流式转给数据服务，数据服务完成解析与图片处理，Worker 登记图库并写入文稿，同时把识别后的稿件保存在 `manuscripts` 表，供之后换风格或纠正结构。
- 团队排版规范存 `teams.typeset_rules`。
- 站点级设置存 D1 `settings`（每个键一份 JSON 加乐观锁版本）。模型提供商、Key（AES-GCM 加密）、调用顺序与各用途参数由 `/admin` 面板编辑（管理员见 `KIUMI_ADMIN_SUBS`），`apps/edge/src/llm.ts` 在每次调用时读取，热生效；模型目录（models.dev 格式，地址可配置）缓存在 Workers Cache API。见 [MODELS.md](MODELS.md)。

## 渲染

有记录 HTML 的编辑块保留布局和 SVG，槽位编辑同步更新记录 HTML；没有记录 HTML 时使用 matrix + 组件骨架渲染。服务端为未修改的旧文稿加载原记录回放。原生块由 core 生成内联 HTML。输出去除可执行脚本与事件属性。

骨架条目数不能当成可编辑模板数：多个模板共用组件。目录索引之间也有重复，数量应按 atomTplId 去重。

## 发布

按用户最新授权：完成一个可用批次后本地提交并推送 main，通过现有 Cloudflare 集成上线。必要时手动部署同一版本。迁移先于使用新字段的 Worker；必要验证为类型检查、相关功能测试、构建和上线关键接口检查。

## 微信与导入

每个团队可绑定多个公众号，AppSecret 在 D1 加密。固定出口的数据服务负责稳定凭证缓存、正文图片转换与上传、封面素材、草稿创建和回读。Sharp 用于把 SVG/WebP 图片转换为微信支持的 PNG（文章内联 SVG 本身保留）。正式发表不由本系统执行。

网页导入服务只取公开资源，不携带用户站点凭证，禁止私网地址；秀米阅读页由前端脚本渲染，数据服务识别其预埋的 `showInfo.show_data_url`，只在秀米自有域名下以 https 读取 show-data JSON，把 `$appendix.htmlForPreview` 连同标题作为文章 HTML 返回，临时链接提示等页面壳不进入导入；浏览器清理 HTML 并内联排版样式。微信不支持的表单/脚本不进入输出。失效模板配图直接移除。

Word/WPS 导入在浏览器内使用按需加载的 Mammoth + JSZip，经过 OOXML 兼容处理、HTML 清理、语义分块和问题预览。带图导入要求团队身份，确认后逐张上传自建存储，成功后一次写入现有 HTML 块；不引入服务端文档转换。ZIP 资源提取按解压大小限制，图片总量 80 MiB、单张 10 MiB。完整行为与降级边界见 [WORD_IMPORT.md](WORD_IMPORT.md)。

## 本地优先编辑

画布和预览复用 core 同步渲染，不逐块等待 Worker。完整目录快照保留同一模板的分类归属，在浏览器筛选、搜索和分页；模板记录先读本地、后台以 ETag 校验，每次页面会话最多校验一次已读取记录。后台单路逐步缓存全库，缓存失败或空间不足时停止；公开镜像素材由受限 Service Worker 缓存。团队内容不进入公共缓存。导出仍经 Worker 生成外部可读的签名图片地址。样式移植、占位文案与缓存边界见 [LOCAL_FIRST.md](LOCAL_FIRST.md)。

## 工作台界面与编辑操作

界面皮肤与文章 HTML 隔离。块工具栏从原始文稿 HTML 编辑 DOM，再经 core 清理并提交 store 历史；无需新增后端编辑接口。模态弹窗和工具条通过 portal 脱离滚动容器和磨砂层。头部封面、标签采用文稿可选 meta 字段，兼容旧文稿。详见 [编辑工作台](EDITOR_DESIGN.md)。
