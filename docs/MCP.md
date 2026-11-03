# 远程 MCP（AI Agent 接入）

登录后的 Agent 可以完成整条链路：建稿 → 导入稿件压缩包 → 套风格 → 校正结构 → 微调 → 审稿预览 → 同步公众号草稿。Agent 的每次修改会**立即出现在已打开的编辑画布上**，不需要刷新。

> 本地开发的 stdio 版（`pnpm mcp`，`packages/mcp`）只读写本机文件目录，用于调试模板；生产使用本文的远程版。

## 接入

端点：`https://<站点>/mcp`（Streamable HTTP，无状态，JSON 响应）。

```bash
claude mcp add --transport http --client-id kiumi-mcp kiumi https://<站点>/mcp
```

账号中心没有开动态客户端注册，所以 MCP 客户端必须显式使用 client_id `kiumi-mcp`（各客户端的参数名不同，例如 Claude Code 的 `--client-id`）。

首次调用时客户端按 MCP 授权规范完成登录：

1. 未带令牌的请求得到 `401`，`WWW-Authenticate` 指向 `/.well-known/oauth-protected-resource/mcp`。
2. 该元数据（RFC 9728）声明授权服务器就是账号中心（`ID_ISSUER_URL`，Ory Hydra）。
3. 客户端用公共客户端 `kiumi-mcp` 走授权码 + PKCE 登录，拿到 JWT 访问令牌。
4. Worker 用账号中心的 JWKS 校验签名、签发者、过期时间；令牌的 `client_id` 必须在 `MCP_CLIENT_IDS`（默认 `kiumi-mcp`）里，若令牌带 `aud` 则必须包含本站 `/mcp`。令牌不会被转发给任何其他服务。

### 账号中心的登记

生产环境已登记公共客户端 `kiumi-mcp`（2026-11-03）。自建部署时在账号中心新增同样的公共客户端（本仓库不包含该配置，也不存放任何运维信息）：

```json
{
  "client_id": "kiumi-mcp",
  "client_name": "Kiumi MCP",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid profile email offline_access",
  "token_endpoint_auth_method": "none",
  "redirect_uris": ["http://127.0.0.1/callback", "http://localhost/callback"],
  "audience": ["https://<站点>/mcp"]
}
```

回调地址需要覆盖所用 MCP 客户端的固定回调（Claude Code、Cursor 等各不相同）与本机环回地址任意端口；Hydra 对环回地址的端口放宽以实际版本为准，登记后用客户端实测一次。若暂时不登记 `audience`，Worker 会因令牌不带 `aud` 而只靠 `client_id` 校验。

## 工具

| 工具 | 用途 |
|---|---|
| `kiumi_whoami` | 当前用户与团队 |
| `kiumi_list_documents` / `kiumi_create_document` | 文稿列表 / 新建 |
| `kiumi_get_document` | 默认返回每块摘要（省 token）；`view=block` 取单块，`view=full` 取全文 |
| `kiumi_search_styles` / `kiumi_describe_style` | 找风格模板，查看版面结构；带 `documentId` 时返回 `planPrompt`（模板单元与稿件编号清单），供 Agent 自己编排 |
| `kiumi_begin_import` | 返回 15 分钟有效的上传地址，见下 |
| `kiumi_get_manuscript` | 识别出的文章结构大纲，以及仍不确定的段落清单 |
| `kiumi_fix_structure` | 按 `[[序号, 角色]]` 纠正结构并重新排版 |
| `kiumi_apply_style` | 换风格重新排版（`null` 为纯文字）；可带 `plan`（按 `planPrompt` 写的排版方案，`null` 清除），放不下的内容按规范排在相邻位置，不会丢失 |
| `kiumi_edit_document` | 精细修改：`title` `meta` `insert` `replace` `html` `remove` `move`，按块 id |
| `kiumi_replace_text` | 只改标签之间的文字 |
| `kiumi_lint` | 团队排版规范 + 微信兼容检查，返回带块 id 的问题 |
| `kiumi_preview_link` | 1 小时有效的手机宽度预览页，图片无需登录即可读取 |
| `kiumi_typeset_rules` | 读取团队排版规范；创建者可修改 |
| `kiumi_create_wechat_draft` | 同步到团队公众号草稿箱（不发表） |

多个团队时需要 `team` 参数；只属于一个团队时可省略。工具错误以 `isError` 返回稳定的错误码与说明。

## 导入压缩包

压缩包动辄二十多 MB，不适合塞进工具参数，所以导入分两步：

```text
1. kiumi_begin_import { documentId, style? }  → { uploadUrl, curl }
2. 在 shell 里执行返回的 curl（POST 整个 ZIP 或 DOCX 到 uploadUrl）
```

第二步的响应就是结果：识别出的标题与结构大纲、图片匹配情况（需核对的项带候选原图）、未使用的原图（已入团队图库）、仍不确定的段落清单、警告。上传地址由 HMAC 签名，绑定用户、团队、文稿，15 分钟过期，上传大小上限 120 MB。

## 实时同步

- 每篇文稿对应一个 Durable Object（`DocHub`），只做通知转发，不保存文稿；D1 是唯一真相源。
- 文稿有递增的修订号 `rev`。Agent 的修改和网页保存都会使 `rev` 加一，并向所有打开该文稿的编辑器推送 `{rev, by, ops}`。
- 编辑器收到后：修订号连续就在本地应用同一份操作，否则重新载入服务器版本；两种情况都作为**一步可撤销**的修改，本地未保存的内容可用 Ctrl+Z 找回。
- 网页保存带上它所基于的 `baseRev`；落后时返回 409，编辑器提示并载入最新版本，不会静默覆盖 Agent 的修改。

## 安全

- 只接受 Bearer 令牌，不接受 Cookie；跨站写请求仍被来源检查拒绝。
- 所有工具先确认团队成员关系，按团队隔离，Agent 看不到其他团队的文稿与图片。
- 预览链接只对一篇文稿有效；图片使用与导出相同的签名地址。
- 工具不发表文章、不删除文稿、不修改团队成员与公众号凭证。
