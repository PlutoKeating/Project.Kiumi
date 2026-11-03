# 生产 API

Worker 托管网页、OIDC 会话、团队与文稿 API。D1 迁移在 `migrations/`，执行根目录 `pnpm d1:schema`。

`workspace.ts` 统一验证会话和 `X-Team-Id` 成员关系。团队创建者管理邀请与成员；文稿和图库对团队成员共享。旧个人文稿在其所有者首次创建团队时归入团队。

用户图片经 `data.ts` 写入自建数据服务；没有 R2 依赖。原图读取验证团队成员，导出 HTML 时产生独立签名图片地址供外部平台读取。模板和素材目录仍只读。

`pnpm test` 包含 Miniflare 实际 Worker/D1 测试，验证跨团队拒绝访问、邀请加入和移除后权限撤销。

## 团队公众号

`wechat.ts` 按团队管理多个公众号，只有创建者可绑定/解绑；AppSecret 用 AES-GCM 加密保存在 D1，不回显给浏览器。自建数据服务用固定出口调用微信稳定凭证接口，上传正文图片与封面、创建草稿并回读。提交使用 requestId 去重，网络重试不会自动新建重复草稿。

`POST /api/import/url` 从自建服务获取公开网页；仅登录团队成员可用，拒绝内网地址，固定 DNS 解析结果后连接。Worker 原样转发数据服务的 `{html,url}`；秀米链接的正文提取在数据服务 `deploy/ecs-data/import.mjs` 完成。

签名图片导出可再次导入和导出，不会重复附加域名或签名参数。Worker 测试覆盖签名地址的外部读取和重复导出。

Word 导入不增加 Worker 转换接口。扩展的 Worker/D1 回归验证导入的标题、正文、图片和合并表格在保存回读、签名导出及草稿服务请求中保持完整；草稿服务为测试替身，真实微信仍需上线前验证。

公开目录新增 `/api/catalog/index` 完整快照；目录、分类、查询和详情响应支持 ETag/304，按 GET 弱比较规则兼容边缘压缩后的 ETag。模板详情可用 `localAssets=true` 返回镜像地址。上传使用团队隔离的内容哈希 ID，重复请求复用同一文件/记录，兼容既有 UUID 图片，无 D1 迁移。编辑态渲染允许内部资源地址，导出校验仍严格。相关 Worker/D1 测试覆盖条件请求、上传重试去重、内部图片校验与签名导出。

## 稿件、MCP 与实时同步

- `mcp.ts`：远程 MCP（JSON-RPC over HTTP）。只接受 Bearer 令牌（`auth.ts` 的 `bearerUser`：JWKS 验签、签发者、`client_id` 白名单、可选 `aud`）。工具均先确认团队成员关系，再经 `docs.ts` 的 `commitOps` 写入。
- `docs.ts`：`commitOps` 在当前修订号上乐观写入（最多重试 4 次）并通知；`documentFrom` 把 `rev` 带进 `meta`。
- `hub.ts`：`DocHub` Durable Object，每篇文稿一个，WebSocket Hibernation，不保存状态。`/api/documents/:id/live` 先校验会话与团队成员，再转发到 DO。
- `manuscript.ts`：预签名导入（令牌绑定用户/团队/文稿，15 分钟，HMAC 密钥派生自 `KIUMI_DATA_KEY` 并按用途隔离）、重新排版、lint、预览链接、团队排版规范、模型路由（`callModel` 统一调用 OpenAI 兼容接口：`/api/manuscript/annotate` 结构复核、`/api/manuscript/plan` 排版方案，只供网页；MCP 流程用 Agent 提交的 `plan` 或规则方案，不调用服务端模型）。大文件流式转给数据服务，Worker 不在内存里解压。
- 迁移 `0002_manuscripts.sql` 新增 `documents.rev`、`teams.typeset_rules`、`manuscripts`。已有 `INSERT INTO teams` 改为显式列名，避免新增列破坏位置参数写入。

`pnpm test` 的 `mcp.test.ts` 用 Miniflare 覆盖：401 挑战与元数据、错误客户端/过期/错误受众令牌、导入、按块编辑、重新排版、lint、预览链接、跨用户隔离、WebSocket 实时通知与 `baseRev` 冲突。
