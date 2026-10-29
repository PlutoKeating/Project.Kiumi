# Cloudflare 部署（Git 集成，非 GitHub Action）

一个 Worker 同时托管前端与后端，仓库 push 后由 Cloudflare 自动构建部署。

---

## 当前状态

代码已就绪，部署需自行准备：Cloudflare 账号（Workers + D1）与一个提供数据的对象存储或自建数据服务。
具体账号、库 ID、主机地址等运维信息只保存在私有环境变量与私有运维记录里，**不进入本仓库**。

## 0. 前提

| 资源 | 用途 | 一次性创建 |
|---|---|---|
| Worker `kiumi` | 前端静态资源 + `/api` | 由 Git 集成创建 |
| R2 桶 `kiumi-data` | 模板、骨架、素材、上传 | 需手工建一次 |
| D1 库 `kiumi` | 文档 | 需手工建一次 |

**Git 自动部署只带走代码。** 模板目录（411 MB）与素材镜像（2.3 GB）进不了仓库，
必须由 `kiumi sync r2` 灌进 R2。之后改代码照常 push；改数据才需要重跑 sync。

---

## 1. 一次性资源

```bash
# R2
npx wrangler r2 bucket create kiumi-data

# D1
npx wrangler d1 create kiumi          # 记下返回的 database_id
npx wrangler d1 execute kiumi --file=apps/edge/schema.sql --remote
```

把 `database_id` 填进 `apps/edge/wrangler.jsonc`。

## 2. 灌数据（2.7 GB）

在 R2 控制台创建 Access Key（R2 → Manage API Tokens → 创建，权限 Object Read & Write），
然后：

```bash
export R2_ACCOUNT_ID=<账号 ID>
export R2_ACCESS_KEY_ID=<key>
export R2_SECRET_ACCESS_KEY=<secret>

pnpm kiumi sync r2 --dry-run          # 先看会传多少
pnpm kiumi sync r2 --concurrency 8    # 实际上传
```

`data/catalog/modern/`（355 MB 现代库载荷）默认跳过；需要时用 `--only catalog` 前先移出排除列表。

## 3. 密钥

Worker 里不能写死密钥，用 Secret：

```bash
npx wrangler secret put WECHAT_APP_ID       --config apps/edge/wrangler.jsonc
npx wrangler secret put WECHAT_APP_SECRET   --config apps/edge/wrangler.jsonc
npx wrangler secret put WECHAT_DEFAULT_THUMB_MEDIA_ID --config apps/edge/wrangler.jsonc
```

## 4. 连接 Git 仓库（Cloudflare Workers Builds）

Cloudflare 控制台 → Workers & Pages → Create → **Import a repository**（不是 Pages 项目）：

| 字段 | 值 |
|---|---|
| 仓库 | 本仓库 |
| 分支 | `main` |
| 构建命令 | `pnpm install && pnpm --filter @kiumi/web build` |
| 部署命令 | `pnpm --filter @kiumi/edge exec wrangler deploy` |
| 根目录 | `/` |

之后每次 `git push` 到 `main`，Cloudflare 会自动构建并部署。
**不使用 GitHub Actions**，仓库里也没有 workflow 文件。

## 5. 本地预览

```bash
pnpm --filter @kiumi/web build
pnpm --filter @kiumi/edge exec wrangler dev     # 本地 Worker + 静态资源
```

`wrangler dev` 时 R2/D1 走本地模拟，数据需先 `wrangler r2 object put` 或直接用远程模式：

```bash
pnpm --filter @kiumi/edge exec wrangler dev --remote
```

## 6. 与 Node 服务端的关系

`apps/server` 保留为本地/自托管形态（素材镜像、批量抓取、`kiumi` CLI 都依赖它）。
线上走 `apps/edge`，两者共用 `@kiumi/core`，渲染结果一致。

## 7. 已知限制

- Worker 单次请求 CPU 时间有限；`/api/render` 对超大文档（>1 MB）可能超时
- R2 免费额度 10 GB 存储，当前数据 2.7 GB 在额度内
- D1 免费额度按行读写计费，文档量级在免费范围内
- `assets-required.json` 与 `assets-manifest.json` 决定覆盖率；缺失素材由 Worker 返回内置占位图

## 让 Worker 读取内网数据服务（Workers VPC）

数据服务只监听内网地址，不开放公网主机名。Worker 通过 Workers VPC 经现有隧道访问它。

1. **隧道开启私有网络**：Cloudflare 控制台 → Networks → Tunnels → 选中数据所在服务器的隧道 →
   Configure → Private Network → 添加服务器内网网段（例如 `10.0.0.0/24`）。
2. **创建 VPC 服务**：控制台 → Workers VPC → Create service →
   选择同一条隧道，主机填数据服务器的内网地址，端口填 `8792`（即 compose 里的发布端口）。
   创建后复制生成的 `service_id`。
3. **部署时注入**：

```bash
export KIUMI_VPC_SERVICE_ID=<上一步的 service id>
pnpm deploy
```

`scripts/gen-edge-config.mjs` 会把它写进 `vpc_services` 绑定，Worker 里对应 `env.KIUMI_DATA`。

代码按这个顺序取数据：VPC 绑定 → `KIUMI_DATA_ORIGIN`（HTTP） → R2 → 占位图。
没有配置前两项时，接口仍可启动，只是模板列表为空。
