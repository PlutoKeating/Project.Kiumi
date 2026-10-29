# 交付说明

本文件回答三件事：**现在有什么、怎么验、还差什么**。

---

## 1. 现在有什么

### 1.1 数据资产

| 项 | 数量 | 位置 |
|---|---|---|
| 模板（去重后） | **3,927** | `data/catalog/templates/*.json` |
| 分类（room） | **43** | `data/catalog/rooms.json` |
| 模板骨架 | **1,360** | `data/catalog/pack.json` |
| 素材 URL 清单 | **3,433** | 记在每条模板的 `assetUrls` |
| 素材镜像 | 见 `find data/assets -type f \| wc -l` | `data/assets/`（gitignore） |

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
| `apps/server` | 20 个 HTTP 端点、素材服务、微信草稿箱 |
| `apps/web` | 三栏工作台：模板库、素材库、画布、槽位编辑、撤销重做 |

---

## 2. 怎么验

```bash
pnpm install
pnpm -r typecheck          # 全仓类型检查
pnpm test                  # 14 个用例：core / server / mcp

pnpm kiumi audit           # 全库保真指标（见下）
pnpm serve                 # API :8787
pnpm --filter @kiumi/web dev   # 工作台 :5180
```

`pnpm kiumi audit` 的基线（实测）：

```
house          total  errors  warnings  bytes/upstream
booklet-cp       146       0         1  1.132
paper-cp       3228      31        24  0.766
booklet-pg       553     553         0  53.236
```

- `paper-cp` 的 31 个 error 全部来自 `form` 组件的 `<input>`——微信正文会剥离表单，属预期。
- `booklet-pg` 是 H5 整页（`tn-layer` 绝对分层），不参与文章渲染。
- 文本保真：`paper-cp` 3,228 条中 **3,153 条（97.7%）的纯文本与上游逐字一致**。

手工验收路径：

1. `pnpm kiumi render --tpl demo:header/t-a-01 --set 'txt1=<p>一日三餐</p>' -o out.html`
2. 打开 `out.html`，全选复制，粘贴到公众号后台草稿 —— 样式应完整保留
3. 在工作台里：选模板 → 插入 → 改槽位 → 复制到公众号

---

## 3. 还差什么

| 项 | 状态 | 说明 |
|---|---|---|
| 会员库 / 高级 SVG 动效 | 待凭证 | 需要你提供 `XIUMI_COOKIE`，抓取器已支持注入 |
| 素材全量镜像 | 进行中 | CDN 会突发封禁，已加熔断；`pnpm kiumi crawl assets` 可反复续跑 |
| 工作台「收藏 / 剪贴板 / 我的图库」 | 占位 | 面板已在，功能未接 |
| 拖拽排序、格式刷 | 未做 | 目前用上下移动按钮 + 撤销重做替代 |
| 微信草稿箱真实联调 | 未做 | 代码就绪，需要测试号 AppID/Secret + IP 白名单 |
| 前端像素级对齐 | 不做 | 按决策 D-04：功能对等、自有视觉 |

---

## 4. 已知缺陷与取舍

1. **字节量比上游小 ~23%**：我们不加 `tn-cell` 系列 class、颜色用简写、无 `!important`。
   视觉等价，但字符串不可能逐字节相同。同源校验改用「纯文本一致率」。
2. **SVG 贴纸依赖镜像**：本地有文件时内联为 `<svg>`；没有时退回 `<img src>`，仍可显示但不可换色。
3. **`SLOT_NOT_FOUND` 24 例**：上游数据里 matrix 带了骨架不认识的 slot（历史版本漂移），这些 slot 会被跳过而不是硬塞。
4. **`booklet-pg` 渲染无意义**：SDK 会给出 `H5_PAGE_UNSUPPORTED` 警告，请勿当文章用。
5. **Node 类型剥离限制**：源码不能用 `enum` / `namespace` / 构造器参数属性——已全部避开，后续也要遵守。
