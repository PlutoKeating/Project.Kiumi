# Kiumi

公众号图文排版系统：**模板库 + 块编辑器 + 确定性渲染器 + 微信合规校验**。

同一套核心能力，三种交付形态：

- **CLI** — 脚本化排版、批量出稿
- **SDK** — 嵌进你自己的流水线
- **MCP** — 让 AI 直接操作排版

再加一个浏览器工作台。

---

## 为什么是确定性渲染

排版工具的通病是把渲染绑在浏览器上：要开无头浏览器、出图慢、没法做回归测试。
Kiumi 的渲染器是**纯函数**：`(文档树, 模板骨架) → HTML 字符串`，无 DOM、无网络、无随机。
于是同一份输入在 CLI、MCP、服务端、前端产出的字节完全一致，可以用 golden-file 快照锁住每次改动。

## 快速开始

```bash
pnpm install
pnpm kiumi crawl all                 # 抓取模板库（约 2,400 条）
pnpm kiumi list --room paper-cp:header --q 标题
pnpm kiumi render --tpl demo:header/t-a-01 -o out.html
pnpm kiumi validate out.html
```

详见 [`docs/QUICK_START.md`](docs/QUICK_START.md)。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `packages/core` | 模型、DSL、水合渲染、校验（无 IO） |
| `packages/catalog` | 抓取、归一化、素材镜像（唯一做网络 IO 的地方） |
| `packages/sdk` | 统一门面，供 CLI / MCP / server 复用 |
| `packages/cli` | `kiumi` 命令行 |
| `packages/mcp` | MCP server |
| `apps/server` | Fastify + Drizzle/SQLite 的 HTTP API |
| `apps/web` | React 工作台 |
| `data/` | 归一化 catalog（入库）+ 镜像素材（gitignore） |

## 文档

- [`docs/RESEARCH_XIUMI.md`](docs/RESEARCH_XIUMI.md) — 秀米平台逆向报告、数据源、块模型、DSL
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 架构、双路径渲染、存储、决策记录
- [`docs/API.md`](docs/API.md) — HTTP / SDK / CLI / MCP 四层契约
- [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) — 里程碑、验收标准、风险
- [`docs/QUICK_START.md`](docs/QUICK_START.md) — 本地跑起来

## 状态

开发中。里程碑进度见 `docs/DEVELOPMENT_PLAN.md`。

## 许可

MIT。模板与素材的版权归原作者，本项目仅在本地做结构存档与自用渲染。
