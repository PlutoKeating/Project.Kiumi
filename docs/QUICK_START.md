# 快速开始

## 前置

- Node.js ≥ 22.6（本项目直接运行 `.ts`，依赖 Node 的 type stripping）
- pnpm 12.11.2（与 packageManager 一致）

```bash
node -v && pnpm -v
```

## 安装

```bash
pnpm install
pnpm -r typecheck
```

## 稿件导入相关

数据服务（`deploy/ecs-data`）自带一份 core 模块副本，改动 `packages/core` 的稿件模块后执行：

```bash
pnpm sync:ecs-core                 # 复制到 deploy/ecs-data/core
cd deploy/ecs-data && npm ci       # 本地跑数据服务测试需要先装依赖，否则其 sharp 测试自动跳过
```

## 抓取模板库

首次运行会拉取分类树、全部模板条目、骨架包与缺失骨架。默认 3 请求/秒。

```bash
pnpm kiumi crawl templates
```

预期输出（数字随上游变化）：

```json
{ "templates": 3927, "rooms": 43, "skeletons": 1360, "missingSkeletons": 0, "skippedRooms": 0 }
```

素材（图片 / SVG）本地镜像，覆盖旧库与现代库共 9,508 个 URL：

```bash
pnpm kiumi crawl assets --limit 50              # 先试 50 个
pnpm kiumi crawl assets --source all --rps 2    # 全量，可反复续跑（约 1.6 GB）
curl -s localhost:8787/api/assets/coverage      # 看覆盖率与缺失
KIUMI_STRICT_ASSETS=1 pnpm serve                # 严格模式：不回源 CDN
```

线上完整库（可选，需要你的登录 Cookie）：

```bash
# 1) 先探测这把 Cookie 能读到哪些端点
XIUMI_COOKIE='<cookie 头>' pnpm kiumi crawl probe

# 2) 再按探测结果抓取
XIUMI_COOKIE='<cookie 头>' pnpm kiumi crawl templates
```

`probe` 会逐个打 49 个候选端点并打印状态码；公开的 4 个总是 200
（`paper/comp`、`paper/page`、`booklet/comp`、`booklet/page`），需登录端点需要有效 Cookie。

Cookie 只从环境变量或 `--cookie` 读取，不写盘、不进日志。

秀米「风格排版」店铺（需要登录 Cookie；完整分页与搜索都依赖登录态）：

```bash
# 1) 先枚举店铺列表；每页 72，约 1,361 页
pnpm kiumi crawl shop-list --price all --show-type paper --rps 3

# 2) 抓正文。owned = 免费 + 账号已购；all 需要运营方确认再分发授权
pnpm kiumi crawl shop --scope free --max-items 20 --merge     # 先跑 20 条验证
pnpm kiumi crawl shop --scope owned --rps 3 --concurrency 3   # 可反复续跑
pnpm kiumi shop merge                                         # 手动合并索引

# 3) 图片流式下载到 data/assets（20 GiB 预算），完成后重写为本地路径并剪掉缺图记录
pnpm kiumi crawl shop-assets --concurrency 8 --rps 8 --budget-gb 20
pnpm kiumi shop localize
```

并行抓正文时用 `--offset/--max-items` 分片，并加 `--no-index`，最后由主进程跑一次
`pnpm kiumi shop localize` 重建索引；不要同时跑多个 `shop merge`。

店铺条目写入 `data/catalog/modern/`，分类为「风格排版」，复用现有模板浏览、
编辑、预览和导出；`shop` 字段保留价格、作者、原站链接与授权标记。

## 浏览

```bash
pnpm kiumi stats
pnpm kiumi list --room demo:header --limit 20
pnpm kiumi list --q 标题 --has-svg
pnpm kiumi show demo:header/t-a-01
```

## 渲染

直接渲染一个模板并替换文字：

```bash
pnpm kiumi render --tpl demo:header/t-a-01 \
  --set 'txt1=<p>一日三餐</p>' \
  -o out.html
```

渲染会同时跑微信合规校验，有 error 时退出码为 1。

生成可再次编辑的文档 JSON：

```bash
pnpm kiumi fill demo:header/t-a-01 --set 'txt1=<p>一日三餐</p>' -o doc.json
pnpm kiumi render doc.json -o out.html
```

校验既有 HTML：

```bash
pnpm kiumi validate out.html --json
```

## MCP

```bash
KIUMI_DATA_DIR=./data pnpm mcp
```

在任意 MCP 客户端里注册（`stdio`）：

```json
{
  "mcpServers": {
    "kiumi": {
      "command": "node",
      "args": ["/absolute/path/to/Project.Kiumi/packages/mcp/src/index.ts"],
      "env": { "KIUMI_DATA_DIR": "/absolute/path/to/Project.Kiumi/data" }
    }
  }
}
```

工具清单见 `docs/API.md`。

## 启动服务端与前端

```bash
pnpm serve        # API :8787
pnpm dev          # API + Vite :5180
# 或分别启动
node apps/server/src/index.ts
pnpm --filter @kiumi/web dev
```

浏览器打开 http://127.0.0.1:5180 。本地 Fastify 用于模板和排版开发；完整登录、团队与云端文稿链路由生产 Worker/D1 提供，部署见 DEPLOY_CLOUDFLARE.md。

## Markdown 转稿

```bash
pnpm kiumi md article.md -o doc.json
pnpm kiumi render doc.json -o out.html
```

## 测试

```bash
node --test packages/core/test/render.test.ts
node --test packages/mcp/test/smoke.test.ts
```

## 数据目录

```
data/
├── catalog/            归一化结果（gitignore）
│   ├── index.json      轻量索引
│   ├── rooms.json      分类
│   ├── pack.json       tplId -> 骨架 HTML
│   └── templates/      每条模板一个文件（matrix + html）
├── raw/                原始接口响应（gitignore）
├── assets/             镜像素材（gitignore）
├── documents/          用户文档
└── uploads/            上传图片
```

`data/assets` 与 `data/raw` 用命令复现，不入库。整个 data 目录不入库，开发时使用本机数据或重新抓取。

## 常见问题

**`catalog not found`** — 还没抓取。跑 `pnpm kiumi crawl templates`。

**渲染出现 `SKELETON_MISSING`** — 该 `tplId` 的骨架既不在内容包里也不在 CDN 上；渲染器会退回通用布局，不影响出稿。

**`SLOT_NOT_FOUND`** — 上游数据里该模板的 matrix 带了骨架不认识的 slot（多为历史版本差异），该 slot 会被跳过。

**抓取报 `Auth:Failed_NotLogin`** — 说明访问到了线上完整库接口；需要设置 `XIUMI_COOKIE`，或忽略（公开库已足够）。
