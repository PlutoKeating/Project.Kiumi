# 交接说明

写给接手这个仓库的人。目标是一小时内能在本地跑起来、看懂数据怎么走、知道哪里容易踩坑，以及下一步该做什么。

仓库是公开的：里面只有代码。账号编号、库编号、主机地址、密钥一律不进仓库，只存在部署环境和你本机的 `.env.local`。

---

## 1. 现在能做什么

打开 <https://kiumi.plutokeating.beer>：

- 左侧按分类浏览模板（标题、卡片、图片、布局、SVG、组件、热门），点一下插进中间文稿
- 画布上双击改字，选中后在右侧改样式、换图片、调顺序
- 顶栏换主题色，能自动换色的模板会跟着变
- 拖图片进画布，自动上传并插入
- 「复制到公众号」把排版结果贴回微信后台；「导出 HTML」拿到完整文件
- 登录后文稿存在账号下，换设备打开还在

命令行、SDK、MCP 服务共用同一套排版引擎，产物字节一致。

## 2. 代码地图

| 目录 | 作用 | 关键文件 |
|---|---|---|
| `packages/core` | 排版引擎，纯函数，无网络无 IO | `render.ts`、`validate.ts` |
| `packages/catalog` | 模板与素材的整理、去重、清单 | `index.ts` |
| `packages/sdk` | 门面：`createKiumi()`，被 cli/mcp/server 复用 | `index.ts` |
| `packages/cli` | 命令行 `kiumi` | `index.ts`、`sync.ts` |
| `packages/mcp` | 给 AI 客户端用的工具集 | `index.ts` |
| `apps/edge` | Cloudflare Worker：网页 + 接口 + 登录 | `src/index.ts`、`src/auth.ts`、`schema.sql` |
| `apps/web` | 浏览器工作台（React + Vite + Tailwind） | `src/App.tsx`、`src/store.ts`、`src/components/` |
| `apps/server` | 本地服务（Fastify），开发与推送草稿用 | `src/app.ts` |
| `deploy/ecs-data` | 只读数据服务，跑在自建机器上 | `server.mjs` |
| `scripts` | 构建期生成部署配置 | `gen-edge-config.mjs` |

## 3. 数据在哪里，怎么流动

模板和素材不进仓库，也不放云存储，只在一台自己维护的机器上（下称「数据机」）。

```
浏览器 ─► Worker（静态资源 + /api）
             │
             ├─ D1：文稿
             └─ VPC 服务 ─► 隧道 ─► 数据机上的只读 HTTP 服务 ─► data/catalog、data/assets
```

Worker 读数据分三级，按顺序尝试：`env.KIUMI_DATA`（VPC 绑定）→ `env.KIUMI_DATA_ORIGIN`（HTTP 回退）→ R2（可选）→ 内置占位图。

数据机上的目录长这样：

```
data/
  catalog/
    index.json            经典模板清单
    modern-index.json     新版模板清单（较大，5 MB 级）
    modern-rooms.json     版本模板的分类计数（几百字节，首页用）
    assets-required.json  所有被引用到的素材地址
    assets-manifest.json  已落地素材的地址 → 本地路径与校验值
    assets-coverage.json  预聚合的覆盖率（首页与自检用）
    assets-missing.json   地址已失效、无法落地的素材清单
    pack.json             组件骨架（决定能否按槽位重排）
    templates/  modern/  svg-anim/     每条模板的记录
  assets/                 素材本体，按原始地址映射成路径
  documents/  uploads/    本地服务用
```

**隧道带宽有限，别让 Worker 每次读大文件。** 首页那几个接口已经换成预聚合的小文件 + 边缘缓存（`readObject` 里的 Cache API，5 分钟）。新增接口时先想清楚要读多大的文件；超过 1 MB 就该预聚合。

## 4. 本地跑起来

```bash
pnpm install
pnpm dev            # 本地服务 + 工作台，改前端热更新
pnpm test           # 14 个用例，约 1 秒
```

需要真实模板时，把数据目录指过去：

```bash
KIUMI_DATA_DIR=/path/to/data pnpm serve
```

命令行常用：

```bash
pnpm kiumi list --room paper-cp:header --limit 5
pnpm kiumi render --tpl paper-cp:12-14/6 -o out.html
pnpm kiumi validate out.html
pnpm kiumi fill paper-cp:12-14/6 --set 'txt1=<p>标题</p>'
pnpm kiumi sync r2                 # 需要 R2 凭证时才用
```

## 5. 部署

一个 Worker 同时托管前端和接口，走 Cloudflare 的 Git 集成：push 到 `main` 就构建。

面板里「构建」一栏填：

| 项 | 值 |
|---|---|
| 构建命令 | `corepack enable && pnpm install --frozen-lockfile && node scripts/gen-edge-config.mjs && pnpm build:web` |
| 部署命令 | `npx wrangler deploy -c apps/edge/wrangler.generated.jsonc` |
| 根目录 | `/` |

`gen-edge-config.mjs` 把 `apps/edge/wrangler.jsonc` 的占位符换成真实标识：环境变量给了就用，没给就带着构建环境的凭证去查（库按名字 `kiumi`，VPC 服务按名字 `kiumi-data`）。所以仓库里一个编号都不用存。

本机手动部署：`pnpm deploy`（先在 `.env.local` 放好账号与标识）。

详细步骤见 [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md)。

## 6. 账号与权限

- 登录走标准授权码 + PKCE，代码在 `apps/edge/src/auth.ts`
- 令牌只在服务端换成会话，浏览器拿到的是 `HttpOnly` cookie（`kiumi_session`，HMAC 签名，30 天）
- `/api/me` 返回当前用户；`/api/documents*` 未登录返回 `401 LOGIN_REQUIRED`
- 文稿表有 `owner_sub` 列，查询一律带条件，看不到别人的稿子
- 账号服务里注册的客户端必须包含当前域名的回调地址，换域名要同步改，否则授权会被拒

身份服务地址和客户端编号通过 `ID_ISSUER_URL`、`ID_CLIENT_ID` 注入，属于部署配置。

## 7. 渲染管线（最容易看错的地方）

一条模板记录里有四样东西：

| 字段 | 含义 |
|---|---|
| `matrix` | 结构化的组件树，每个组件有一组槽位（`txt1`、`img1`…） |
| `html` | 成品 HTML，逐字节保存，用于像素级还原 |
| `pack`（全局） | 组件骨架，决定能否按槽位重新拼装 |
| `skeleton` | 单个组件的模板片段 |

渲染优先级：

1. 有骨架的模板 → 按 `matrix` + 骨架拼装，改字改图都生效
2. 缺骨架且**没有**改动 → 回放 `html`，与原始成品一致
3. 缺骨架但改过槽位 → 只能走简化拼装，样式会退化（见第 9 节）

判断"改没改"是比较 `matrix` 的序列化结果（`packages/sdk/src/index.ts` 的 `renderDocument`）。所以任何绕过 `fillMatrix` 直接改 `matrix` 的写法都会让回放失效，注意保持一致。

## 8. 已知限制

| 现象 | 原因 | 怎么处理 |
|---|---|---|
| 25,745 个模板里只有 1,271 个带骨架 | 骨架包覆盖不全 | 改字前先在右侧确认能否编辑；补骨架是下一步首要任务 |
| 缺骨架的模板改字后样式变简单 | 只能按槽位重排，丢掉原样式细节 | 同上 |
| 2,201 个素材显示占位图 | 地址在原站就已失效，取不到 | 已记录在 `assets-missing.json`，无需再试 |
| 首次打开模板列表要一两秒 | 隧道冷启动 | 已加边缘缓存与预聚合；仍慢可先热一次 |
| SVG 类模板改字无效 | 成品的图形在上游生成，回放无法替换 | 接口会返回 `SLOT_OVERRIDE_IGNORED` 警告 |

## 9. 容易踩的坑

- **`/auth/*` 和 `/api/*` 必须出现在 `assets.run_worker_first`**，否则会被单页应用的回退吞掉，表现为访问登录地址却回到首页。
- **pnpm 12 会拦安装脚本**：新增带 postinstall 的依赖（如 `workerd`）要写进 `pnpm-workspace.yaml` 的 `allowBuilds`，否则 Cloudflare 构建直接失败并报 `ERR_PNPM_IGNORED_BUILDS`。
- **`wrangler.jsonc` 里的占位符不能直接用于命令**：`d1 execute` 之类要带 `-c wrangler.generated.jsonc`，否则会因为桶名非法而报错。
- **`git filter-repo` 会 `reset --hard` 并清掉未跟踪文件**：`data/` 已在 `.gitignore`，重跑前先确认数据不在工作区里，或者先备份。
- **受众字段可能是数组**：校验 `id_token` 时要同时接受字符串与列表（`aud`）。
- **文稿表加列**：老库需要 `ALTER TABLE documents ADD COLUMN owner_sub TEXT;`，`schema.sql` 里已注明。

## 10. 下一步

按优先级：

1. **补骨架**：让改字后的成品保持原样式。这是当前体验最大的缺口。
2. **组件交互**：表单、视频、时间线这类块目前只有基础编辑，缺画布内的专门面板。
3. **文档配图**：`docs/images/` 还是旧界面截图，交互定稿后统一换。
4. **画布细节**：缩放快捷键、触控板手势、多选与批量操作。

## 11. 排查手册

| 症状 | 先看哪里 |
|---|---|
| 接口 500，提示数据服务不可达 | 隧道是否在线；VPC 服务的地址与端口 |
| 模板列表空 | `data/catalog/index.json` 是否存在；`KIUMI_DATA_DIR` 是否指对 |
| 登录后仍是未登录 | 回调地址是否登记；会话 cookie 的域名与当前访问域名是否一致 |
| 复制到公众号丢样式 | 微信会剥离部分样式，先用 `pnpm kiumi validate` 看规则告警 |
| 构建成功但线上是旧版 | 面板部署命令是否指向 `wrangler.generated.jsonc` |

## 12. 交付前自检

```bash
pnpm typecheck
pnpm test
pnpm build:web
curl -s https://<域名>/api/health
curl -s https://<域名>/api/rooms | head -c 200
curl -s https://<域名>/api/assets/coverage
```

四条接口都返回 `ok: true`，并且 `pnpm test` 全绿，才算这一版可用。
