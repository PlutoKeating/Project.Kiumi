<div align="center">

# Kiumi

排版公众号图文：挑一个模板，在画布上改字换图，复制出来就能贴进公众号后台。

**[kiumi.plutokeating.beer](https://kiumi.plutokeating.beer)**

</div>

![工作台](docs/images/workbench-card.png)

## 怎么用

1. 打开上面的网址。
2. 在左侧点一个模板缩略图，它会出现在中间的文稿里。
3. 双击文字就能改；选中任意一块，右侧可以调字号、颜色、图片地址。
4. 点「复制到公众号」，到公众号后台粘贴。

![操作流程](docs/images/flow.svg)

## 四块界面

![界面说明](docs/images/ui-map.svg)

| 位置 | 作用 |
|---|---|
| 最左一条 | 切换模板、素材、收藏、剪贴板、我的图库 |
| 左边的面板 | 浏览模板，点一下就用 |
| 中间画布 | 你的文稿，看到的就是发出去的样子 |
| 右侧 | 选中的那块内容的设置 |

## 常用操作

| 想做的事 | 怎么做 |
|---|---|
| 改文字 | 在画布上双击那段文字 |
| 换图片 | 选中那块，在右侧填图片地址，或从素材库里点一张 |
| 调整顺序 | 在右侧结构列表里拖动 |
| 换个颜色 | 顶栏点主题色，能换色的模板会一起变色 |
| 统一格式 | 选中一块按 `Ctrl+Alt+C` 取格式，再选另一块按 `Ctrl+Alt+V` |
| 撤销 | `Ctrl+Z` |
| 删除 | 选中后按 `Delete` |
| 换顺序 | 直接拖动块，或用块右上角的小箭头 |
| 选中别的块 | `↑` `↓` 逐块移动，`Esc` 取消选中 |
| 插入空行 | 在画布上右键，选「前插空行」或「后插空行」 |

登录后文稿会存到你的账号下，换一台设备打开还在。没登录也能排版和导出。

## 模板和图片放在哪里

模板和图片保存在自己的数据服务里，由这台服务提供给网站。仓库里只有代码，没有模板和图片。

## 给开发者

```bash
pnpm install
pnpm dev        # 本地 API 与工作台
pnpm test
```

| 目录 | 内容 |
|---|---|
| `packages/core` | 排版引擎：把模板和数据变成最终 HTML |
| `packages/catalog` | 模板整理与素材同步 |
| `packages/sdk` | 给命令行、MCP、服务端共用的接口 |
| `packages/cli` | `kiumi` 命令行 |
| `packages/mcp` | 给 AI 客户端用的 MCP 服务 |
| `apps/edge` | Cloudflare Worker，同时提供网页与接口 |
| `apps/web` | 浏览器里的工作台 |
| `apps/server` | 本地服务，用于查看素材与推送草稿 |
| `deploy/ecs-data` | 数据服务，只读，提供给 Worker |

命令行常用的几条：

```bash
kiumi list --room <分类> --q <关键词>
kiumi render --tpl <模板编号> --set 'txt1=<p>标题</p>' -o out.html
kiumi validate out.html
kiumi audit
```

更细的说明在 [`docs/`](docs/)。

## 现在的状态

| 项 | 结果 |
|---|---|
| 模板 | 25,745 个可分页浏览（3,927 个经典模板 + 21,818 个新版模板） |
| 渲染 | 有骨架的按组件拼装，缺骨架的回放模板原始结构，0 失败 |
| 素材 | 9,508 个引用，7,306 个已放到本地；剩下 2,201 个在原站就取不到，页面回落到占位图 |
| 登录 | 用现有账号体系登录，文稿按账号分开保存 |
| 测试 | 14 个自动用例 |
| 公众号 | 已用真实公众号跑通：取凭证、传封面、建草稿、回读确认 |

## 文档

- [架构](docs/ARCHITECTURE.md)
- [交接说明](docs/HANDOFF.md)
- [接口](docs/API.md)
- [界面与快捷键](docs/UX_XIUMI.md)
- [部署](docs/DEPLOY_CLOUDFLARE.md)
- [快速开始](docs/QUICK_START.md)
