# 部署

一个 Worker 同时托管前端与接口。数据放在自建服务器上，Worker 通过隧道连过去，
不需要对外暴露主机名或公网地址。写完代码 push 到 `main`，Cloudflare 自己构建部署。

---

## 1. 结构

```
浏览器 ──► Worker（前端静态资源 + /api）
              │
              ├─ D1：团队、文稿、图库索引、加密公众号凭证
              └─ VPC 服务 ──► 隧道 ──► 数据服务（模板目录、素材镜像）
```

模板目录和素材镜像不进仓库，也不放进任何云存储，只在一台自己维护的机器上。

## 2. Cloudflare 侧要准备什么

| 资源 | 用途 | 说明 |
|---|---|---|
| Worker `kiumi` | 前端与接口 | 由 Git 集成创建 |
| D1 库 `kiumi` | 团队与文稿数据 | 执行 `pnpm d1:schema` 应用增量迁移 |
| 隧道 | 打通到数据服务 | 已运行的 `cloudflared` 即可复用 |
| VPC 服务 `kiumi-data` | Worker 侧的连接句柄 | 指向数据服务的内网地址与端口 |

三样东西的 ID 都不写进仓库。构建时若未通过环境变量给出，脚本会用构建环境自带的
凭证去查：数据库按名字 `kiumi` 找，VPC 服务按名字 `kiumi-data` 找。

## 3. 构建与部署命令

Cloudflare 面板 → Workers 和 Pages → `kiumi` → 设置 → 构建：

| 项 | 值 |
|---|---|
| 生产分支 | `main` |
| 构建命令 | `corepack enable && pnpm install --frozen-lockfile && node scripts/gen-edge-config.mjs && pnpm build:web` |
| 部署命令 | `npx wrangler deploy -c apps/edge/wrangler.generated.jsonc` |
| 根目录 | `/` |

`gen-edge-config.mjs` 把 `apps/edge/wrangler.jsonc` 里的占位符换成真实标识，
产物 `wrangler.generated.jsonc` 已在 `.gitignore` 中，不会被提交。

## 4. 变量与密钥

Worker 的密钥在面板或用 wrangler 写入，仓库里只留 `.env.example`：

```bash
npx wrangler secret put KIUMI_DATA_KEY          # 访问数据服务的共享密钥
npx wrangler secret put ID_ISSUER_URL           # 账号服务地址
npx wrangler secret put ID_CLIENT_ID
```

本地部署时这些值也可以写进 `.env.local`（已被忽略）。公众号凭证由团队创建者在网站绑定，加密保存到 D1，不使用全站共享公众号。`KIUMI_DATA_KEY` 同时用于派生凭证加密密钥，轮换前必须迁移已存凭证。

## 5. 数据服务

`deploy/ecs-data/` 提供模板/素材只读访问、受控图片写入与微信代理，依赖 Node 和 sharp。推荐 Docker Compose 启动：

```bash
cd deploy/ecs-data
./start.sh
```

它在 `/health` 返回就绪状态，模板与素材按 `catalog/`、`assets/` 相对路径读取文件；`uploads/` 单独可写挂载，`/wechat` 处理图片上传和草稿同步。公众号后台需把服务器出口 IP 加入白名单。
请求需带 `x-data-key`，否则一律 401。

把它的内网地址与端口登记成 VPC 服务后，Worker 里就用 `env.KIUMI_DATA.fetch()` 访问。

## 6. 确认

```bash
curl https://<你的域名>/api/health      # {"ok":true,"runtime":"worker"}
curl https://<你的域名>/api/rooms       # 房间列表，来自数据服务
curl https://<你的域名>/api/assets/coverage  # 素材本地化比例
```

`/api/rooms` 第一次可能慢一两秒，之后走边缘缓存。

## 7. 常见问题

- **构建报 `ERR_PNPM_IGNORED_BUILDS`**：`pnpm-workspace.yaml` 的 `allowBuilds` 少了条目，
  把报错里的包名加进去。
- **`/auth/*` 返回首页**：`apps/edge/wrangler.jsonc` 的 `assets.run_worker_first` 需要包含 `/auth/*`。
- **接口 500 且提示数据服务不可达**：检查隧道是否在线、VPC 服务的地址与端口是否对得上。

本地优先版本没有新增依赖、密钥或数据库迁移。Vite 将 `apps/web/public/catalog-assets-sw.js` 复制到静态产物根目录，部署时需随网页一起发布；上线检查该地址返回 JavaScript、目录 ETag/304 生效。公共缓存版本与私有团队数据隔离，构建产物继续由现有流水线发布。

工作台视觉/浮动编辑工具栏版本无新增运行时依赖和 D1 迁移；继续采用原构建与部署命令。发布前增加 `pnpm --filter @kiumi/web test:editor`，验证格式、撤销、元数据恢复和浮层边界。Impeccable 全局技能和本机 hooks 不需要安装到 Cloudflare 构建环境。
