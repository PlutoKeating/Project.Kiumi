# 生产 API

Worker 托管网页、OIDC 会话、团队与文稿 API。D1 迁移在 `migrations/`，执行根目录 `pnpm d1:schema`。

`workspace.ts` 统一验证会话和 `X-Team-Id` 成员关系。团队创建者管理邀请与成员；文稿和图库对团队成员共享。旧个人文稿在其所有者首次创建团队时归入团队。

用户图片经 `data.ts` 写入自建数据服务；没有 R2 依赖。原图读取验证团队成员，导出 HTML 时产生独立签名图片地址供外部平台读取。模板和素材目录仍只读。

`pnpm test` 包含 Miniflare 实际 Worker/D1 测试，验证跨团队拒绝访问、邀请加入和移除后权限撤销。
