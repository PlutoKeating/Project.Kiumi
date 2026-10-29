# 交付说明

本文件回答三件事：**现在有什么、怎么验、还差什么**。

---

## 1. 现在有什么

### 1.1 数据资产

| 项 | 数量 | 位置 |
|---|---|---|
| 模板（旧版 rooms 库） | **3,927** | `data/catalog/templates/*.json` |
| 模板（线上标签库） | **21,817** | 索引 `modern-index.json`；载荷 `modern/`（本地） |
| SVG 动效（入库） | **442** | `data/catalog/svg-anim/*.json` |
| 标签体系 | **89 叶子 / 7 一级** | `data/catalog/tags.json` |
| 分类（room） | **43** | `data/catalog/rooms.json` |
| 模板骨架 | **1,360** | `data/catalog/pack.json` |
| 素材 URL 清单 | **3,433** | 记在每条模板的 `assetUrls` |
| 素材镜像（已落盘） | **1186** 个 / 359M | `data/assets/`（gitignore） |

每条模板同时保存：

- `matrix`：结构化块树，可编辑、可重新渲染
- `html`：上游成品，作为保真基准
- 元数据：`atomTplId`、`room`、`accessibility`、`hasSvg`、`version`、`source`、`fetchedAt`

### 1.2 代码

| 包 | 能力 |
|---|---|
| `@kiumi/core` | 块模型、模板水合、原生块渲染、微信合规校验 |
| `@kiumi/catalog` | 限速/重试/熔断抓取、归一化去重、骨架补齐、素材镜像 |
| `@kiumi/sdk` | 目录检索、文档构建、槽位填充、Markdown 转换 |
| `@kiumi/cli` | `crawl / stats / list / show / render / fill / md / validate / audit` |
| `@kiumi/mcp` | 13 个工具（检索、文档、渲染、校验） |
| `apps/server` | 24 个 HTTP 端点、素材服务、微信草稿箱 |
| `apps/web` | 三栏工作台：模板库、素材库、画布、槽位编辑、撤销重做 |

---

## 2. 怎么验

```bash
pnpm install
pnpm -r typecheck          # 全仓类型检查
pnpm test                  # 14 个用例：core / server / mcp

pnpm kiumi audit           # 全库保真指标（见下）
pnpm dev                   # API :8787 + 工作台 :5180
```

容器化部署（已实测构建并运行）：

```bash
docker compose up -d --build
# API  http://127.0.0.1:8787
# 工作台 http://127.0.0.1:5180
docker compose down
```

### 素材本地化（运行时零 CDN 依赖）

```bash
pnpm kiumi crawl assets --source all --concurrency 2 --rps 2   # 可反复续跑
curl -s localhost:8787/api/assets/coverage                      # 覆盖率与缺失清单
pnpm serve                                                      # 默认严格模式（不回源）
KIUMI_STRICT_ASSETS=0 pnpm serve                                # 镜像未齐时允许回源
```

严格模式下一个远端 URL 都不会出现：未镜像的素材会被替换成本地占位图，
并在响应头 `x-kiumi-missing-assets` 与覆盖率接口里列出，便于补齐而不是静默回源。

全量 9,508 个素材在 1.6 GB 量级，无法进 git；`data/assets` 保持 ignore，
由上面的命令复现。

现代库规模（`pnpm kiumi crawl tags` 实测）：

| 分类 | 唯一模板 |
|---|---|
| 标题 | 4,824 |
| 卡片 | 5,445 |
| 图片 | 5,310 |
| 布局 | 1,883 |
| 组件 | 3,863 |
| SVG 动效 | 442 |
| 热门 | 50 |
| **合计** | **21,817** |

`pnpm kiumi audit` 的基线（旧版 rooms 库，实测）：

```
house          total  errors  warnings  bytes/upstream
booklet-cp       146       0         1  1.132
paper-cp       3228      31        24  0.766
booklet-pg       553     553         0  53.236
```

- `paper-cp` 的 31 个 error 全部来自 `form` 组件的 `<input>`——微信正文会剥离表单，属预期。
- `booklet-pg` 是 H5 整页（`tn-layer` 绝对分层），不参与文章渲染。
- 文本保真：`paper-cp` 3,228 条中 **3,153 条（97.7%）的纯文本与上游逐字一致**。

现代库审计（21,817 条）：**0 渲染失败**，仅 18 条表单组件因输出 `<input>` 报 `forbidden-tag`（微信正文会剥离表单，属预期）。

手工验收路径：

1. `pnpm kiumi render --tpl demo:header/t-a-01 --set 'txt1=<p>一日三餐</p>' -o out.html`
2. 打开 `out.html`，全选复制，粘贴到公众号后台草稿 —— 样式应完整保留
3. 在工作台里：选模板 → 插入 → 改槽位 → 复制到公众号

---

## 3. 还差什么

| 项 | 状态 | 说明 |
|---|---|---|
| 线上标签库（全部开放） | 待凭证 | 需要你提供 `XIUMI_COOKIE`，抓取器已支持注入 |
| 素材全量镜像 | 部分（1,186 / 3,433） | CDN 对突发请求会返回 404 软封禁；已加熔断，建议 `--rps 1 --concurrency 2` 分段续跑。已落盘部分足以支撑模板预览与 SVG 内联，其余回落到远程 URL |
| 工作台「收藏 / 剪贴板 / 我的图库」 | 占位 | 面板已在，功能未接 |
| 拖拽排序、格式刷 | 未做 | 目前用上下移动按钮 + 撤销重做替代 |
| 微信草稿箱 | ✅ 已联调 | 取 token → 自动上传封面 → 建草稿 → 回读确认 |
| 前端像素级对齐 | 不做 | 按决策 D-04：功能对等、自有视觉 |

---

## 4. 已知缺陷与取舍

1. **字节量比上游小 ~23%**：我们不加 `tn-cell` 系列 class、颜色用简写、无 `!important`。
   视觉等价，但字符串不可能逐字节相同。同源校验改用「纯文本一致率」。
2. **SVG 贴纸依赖镜像**：本地有文件时内联为 `<svg>`；没有时退回 `<img src>`，仍可显示但不可换色。
3. **`SLOT_NOT_FOUND` 24 例**：上游数据里 matrix 带了骨架不认识的 slot（历史版本漂移），这些 slot 会被跳过而不是硬塞。
4. **`booklet-pg` 渲染无意义**：SDK 会给出 `H5_PAGE_UNSUPPORTED` 警告，请勿当文章用。
5. **Node 类型剥离限制**：源码不能用 `enum` / `namespace` / 构造器参数属性——已全部避开，后续也要遵守。
