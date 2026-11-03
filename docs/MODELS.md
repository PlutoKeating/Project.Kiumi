# 模型配置（站点管理面板）

网页导入用到的模型（结构复核、风格编排）全部在 `/admin` 面板里图形化配置，保存后下一次调用立即生效，不需要重新部署。代码里没有任何提供商地址或模型名。两个用途的系统提示都由团队排版规范生成，风格编排的回答还要经过程序复核，见 [稿件导入](MANUSCRIPT.md#模型与-agent-的规范约束)。

## 谁能进入

部署变量 `KIUMI_ADMIN_SUBS` 列出站点管理员（账号 `sub` 或邮箱，逗号分隔，不区分大小写）。只认网页登录会话；MCP 的 Bearer 令牌不能调用管理接口。管理员登录后，右上角账号菜单出现「模型配置」。未设置时面板会提示如何设置。

## 面板

| 分区 | 内容 |
|---|---|
| 提供商 | 每家可设会话请求头与 User-Agent；模型行可覆盖协议与地址。「添加提供商」从模型目录搜索（↑↓ Enter 选择），自动预填名称、协议、Base URL 与文档链接；也可手动添加。每家：名称、协议、Base URL（「↺ 目录值」恢复）、多把 Key（只写入，显示末 4 位，可停用、备注）、模型（从目录勾选，显示上下文/输出上限/价格/推理/图像输入/更新日期/弃用；也可手填 id）、逐个「测试」连通性、附加请求头、启用开关 |
| 调用顺序与用途 | 全局调用顺序：按住卡片左侧抓手拖动（经过的卡片弹性让位，松手后卡片滑入新位置），也可聚焦抓手按 ↑↓ 或点右侧箭头；标出提供商停用/模型停用/没有 Key；「结构识别」「风格编排」两个用途各自可指定模型顺序（不指定按全局顺序）、输出上限、单次超时 |
| 模型目录 | 目录地址（models.dev 数据格式）；留空用部署变量 `MODEL_CATALOG_URL`；「立即刷新」 |

所有编辑（含排序）只改本地草稿，不发请求、不等待；只有「保存」和「测试」会访问服务器。整页是一份草稿：顶栏显示「已同步 · 版本 N」或「有未保存的更改」，保存时带版本号，别人先保存了会提示刷新（409，草稿保留）。离开页面前有未保存更改会提醒。

## 运行时

- 配置是 D1 `settings` 表里 `llm-config` 一行 JSON（迁移 `0003_settings.sql`），每次模型调用都重新读取。
- 调用链：用途指定的模型（或全局顺序）× 每个模型启用的 Key，依次尝试；超时、HTTP 错误、网络错误、空回复都换下一个；模型拒绝（Anthropic `refusal`）立即停止。全部失败返回 502，网页按规则排版。
- 协议：`openai-chat`（`/chat/completions`，新模型要求 `max_completion_tokens` 时自动改用）、`openai-responses`（`/responses`）、`anthropic-messages`（`/messages`）、`google-generative-ai`（`/models/{id}:generateContent`）。路径由协议决定，地址前缀即 Base URL。
- Key 用 `KIUMI_DATA_KEY` 派生的 AES-GCM 密钥加密，提供商编号作附加数据（Key 不能挪到别的提供商；因此保存后编号不可改）。轮换 `KIUMI_DATA_KEY` 前要重新录入 Key。
- 面板里还没有任何提供商时，沿用旧的部署变量 `LLM_API_URL / LLM_API_KEY / LLM_MODEL`（可选 `LLM_PROTOCOL`，默认 `openai-chat`；`LLM_API_URL` 写到 `/v1` 或完整的 `/chat/completions` 都可以）。面板保存过提供商后以面板为准。
- 逐模型的协议与地址：同一家网关可能把不同模型放在不同接口上（OpenCode Go 的 `minimax-m3` 走 Anthropic Messages 的 `…/inference/go/anthropic/v1`，`minimax-m3.1-flash` 走 OpenAI Chat 的 `…/openai/v1`）。模型目录的模型级 `provider.npm` / `provider.api` 给出这一点，从目录勾选模型时自动带上，面板模型行也可改（协议选「跟随提供商协议」即不覆盖）。与提供商相同的值不单独保存。
- 会话请求头与 User-Agent：提供商可设「会话请求头」，一次导入里的所有模型调用（结构识别与风格编排）都带同一个随机 id（网页生成并随请求传给 Worker；缺失时每次调用自动生成一个）；所有请求都带 User-Agent，默认 `kiumi-typesetter/1.0`，可按提供商修改。两者都不能通过「附加请求头」设置。
- 网关预设：从目录添加 `opencode-go` / `opencode` 时自动把会话请求头设为 `x-opencode-session` 并提示其要求（官方文档要求每个会话带稳定的 `x-opencode-session` 并用可识别的 User-Agent，用于路由与提示缓存；流量受监控）；已保存但缺少时面板提示一键补上。
- MCP 流程不调用这里的模型（Agent 用自己的模型提交 `plan`，见 [MCP.md](MCP.md)）。

## 模型目录

来源 URL 由面板或 `MODEL_CATALOG_URL` 决定（默认部署配置指向 models.dev）。Worker 拉取后只保留面板字段，按「来源 URL」缓存在 Workers Cache API 与模块内存 24 小时，「立即刷新」强制重取，取不到时继续用上一次的目录并显示错误。协议按 AI SDK 包名推断（`@ai-sdk/openai*`、`openrouter`、`xai`、`groq`、`mistral` 等 → `openai-chat`；`@ai-sdk/anthropic` → `anthropic-messages`；`@ai-sdk/google` → `google-generative-ai`），其余标「暂不支持」并按 OpenAI 兼容预填、提示核对。目录没有给 Base URL 的提供商（多为官方 SDK）需要按其文档手填。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/PUT | `/api/admin/llm` | 读取（Key 只回末 4 位、调用顺序与可调用状态）/ 保存（带 `version`，新 Key 用 `apiKey`，已有 Key 用 `id`） |
| GET | `/api/admin/catalog?refresh=1` | 目录提供商摘要、获取时间与错误 |
| GET | `/api/admin/catalog/models?provider=` | 某提供商的目录模型 |
| POST | `/api/admin/llm/test` | `{provider:{id,protocol,baseUrl,headers}, model, apiKey?\|keyId?}` 连通性测试，草稿也能测 |

## 验证

```bash
node --test apps/edge/test/admin.test.ts            # Miniflare：权限、目录、加密、乐观锁、回退、热更新、旧变量兼容
pnpm --filter @kiumi/web exec playwright test admin.spec.ts   # 面板：目录添加、Key、模型、顺序、保存
```
