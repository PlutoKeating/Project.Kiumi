---
name: Kiumi Workbench
description: 明亮、低饱和马卡龙与磨砂玻璃构成的桌面图文工作台
colors:
  primary: "#426c5f"
  focus: "#64867b"
  background: "#f5f4f1"
  ink: "#30302e"
  muted: "#66665f"
  border: "#e5e4df"
  mist: "#f4f3f0"
  lavender: "#eee9f3"
  peach: "#f5e8df"
  sage: "#e1ece5"
  glass: "rgba(255, 255, 255, .72)"
  white: "#ffffff"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  field:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    fontWeight: 400
rounded:
  control: "8px"
  card: "12px"
  toolbar: "14px"
  dialog: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  dialog: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    height: "34px"
  toolbar:
    backgroundColor: "rgba(255, 255, 255, .72)"
    textColor: "#354c40"
    rounded: "{rounded.toolbar}"
    padding: "6px"
  field:
    backgroundColor: "#fafaf8"
    textColor: "#35433a"
    rounded: "{rounded.control}"
    typography: "{typography.field}"
    padding: "8px 10px"
  dialog:
    backgroundColor: "var(--surface-glass)"
    rounded: "{rounded.dialog}"
    padding: "{spacing.dialog}"
---

# 当前重构状态

本文件下方及 `.impeccable/design.json` 暂存上一版素白/鼠尾草系统，**不是当前蓝粉重构的视觉约束**。用户本轮明确指定蓝粉 iOS 液态玻璃，当前方向见 `.impeccable/surfaces/src-app-tsx.md`，实现以 `src/styles.css` 为准。最终组件打磨和独立审查之后统一生成新系统文档与 sidecar；尚未完成全界面验收。

首批已落地：蓝色操作、粉色收藏、浅蓝导航、半透明浮层、文稿/插入两行操作、可键盘操作的模板分类与图片卡片、素材错误重试。当前主色 `#3e68ad`、文字 `#28364b`、背景 `#f0f4fa`、玻璃 `rgba(255,255,255,.72)` / `blur(28px) saturate(135%)`。

# Design System: Kiumi

## Overview

**Creative North Star: "明亮的磨砂编辑台"**

以用户确认的优雅、清爽、对齐、整洁为准：米白工作区搭配素白面板，马卡龙色仅作局部点缀，磨砂浮层提供操作层次。保持桌面编辑器的紧凑信息密度，用柔和底色、留白与清楚的状态降低视觉压力。

本文记录现有实现。界面字体、配色和圆角服务于编辑器外壳；文章正文、模板与导出内容保留各自排版。以 `src/styles.css` 的主题 tokens、工作台规则及组件源码为准。

**Key Characteristics:**
- 明亮底色与低饱和鼠尾草、薰衣草、蜜桃点缀。
- 半透明浮层、柔和阴影和清楚的键盘焦点。
- 桌面多栏布局，正文与编辑器外壳隔离。

## Colors

### Primary
鼠尾草主色用于主要操作和选中反馈；焦点色用于键盘轮廓和边框。

### Secondary
薰衣草用于辅助分区与成对操作。蜜桃、浅鼠尾草作为已声明的辅助表面 token，具体使用依组件而定，不将所有面板染色。

### Neutral
背景、浅雾、玻璃表面与边框形成柔和层次；深墨文字和次级文字保留清晰阅读对比。白色是文章纸张与模板预览的基础。

**The 正文隔离 Rule.** 界面主题不得覆盖文章 HTML 的文字、背景和模板样式，也不得进入导出正文。

## Typography

使用系统无衬线字体栈与中文系统回退，避免额外字体依赖。弹窗标题使用 title token；表单文字使用 field token；紧凑辅助标签使用 label token。工作台品牌字为 18px，面板小标题为 14px。正文排版由模板和用户编辑决定。

## Layout

只面向桌面浏览器。左侧导航宽 76px，模板面板宽 360px，检查器宽 292px，中间画布弹性占用剩余空间。1251–1440px 时，资源面板为 280px、检查器为 260px；视口宽度不超过 1250px 时，资源面板和检查器均收至 250px，画布左右内边距降为 14px。

头部信息行至少 56px，操作行至少 58px；窄桌面操作行允许横向滚动。文章纸张基准宽 430px、最小高 720px，随画布缩放。图文设置采用 80px 方形封面加弹性字段列，间距 16px；作者与标签在展开区双列排列。

浮动工具栏宽度为画布宽减 24px、上限 710px，距画布边缘至少 12px。弹窗离视口四边至少 32px，高宽均受视口限制；不是移动端布局。

## Elevation & Depth

背景使用均匀米白与素白；工具栏与弹出菜单使用内侧白色高光和中性浮层阴影，模态框使用更深的中性阴影。玻璃表面模糊为 28px、饱和度 20%，模态遮罩模糊为 14px。浏览器不支持磨砂时回退到 #fdfdfb。

sidecar 的 tonalRamp 为预览面板合成色阶，不是新增的生产颜色规范。阴影精确值记录在 sidecar 的 shadows；浮动工具栏层级为 35，模态遮罩为 60。控件颜色、边框和阴影采用 150ms ease 过渡；减少动态效果偏好关闭 CSS 动画和过渡。

## Shapes

普通控件使用 control 圆角，卡片与封面使用 card 圆角；工具栏和模态框依次使用更柔和的 toolbar、dialog 圆角。工具栏单按钮使用 7px 圆角，选中内容块使用外移 4px 的 1.5px 柔和绿色轮廓。色彩选择器保持圆形。

## Components

### Buttons
主按钮使用鼠尾草底和白字；顶栏普通操作至少高 34px，弹窗操作至少高 36px。工具栏按钮至少 32×32px，输入框与选择框至少高 32px，颜色选择器宽 32px，悬停变浅绿，按下或菜单展开时显示较深的浅绿底。禁用时降低透明度并显示不可用光标。可聚焦控件具有 2px 焦点轮廓，向外偏移 3px。

### Inputs / Fields
标题与摘要使用浅底、细边框、可见标签。摘要可以纵向调整高度。封面上传中禁止重复选择，错误以状态文本显示；更多设置默认折叠，展开作者、标签及封面移除操作。

### Navigation
窄侧栏以图标加文字呈现分类，按钮宽 64px、最小高 54px。当前项通过 aria-current、强调文字和轻阴影区别于素白导航底。模板浏览区使用紧凑文字筛选按钮，选中状态为淡主色底与主色文字。

### Cards / Containers
模板卡片高 204px、预览区高 132px，两列展示；卡片点击插入，「应用样式」单独触发并要求先选择内容块。预览 iframe 不截获鼠标，保留模板本身视觉。

### 跟随工具栏
默认跟随选中块，可切换为固定在画布顶部。未固定且选中块滚出画布时隐藏；滚动、缩放布局变化时重新定位。菜单一次只展开一个，切换内容块、点击外部或 Escape 可关闭；下方空间受限时向上展开并限制滚动高度。编辑操作沿用文稿状态与撤销机制。「收藏」保存完整块的内容与样式，在左侧「图文收藏」复用；收藏状态独立于块剪贴板。

### Modal
统一传送到 document.body，避开画布滚动与半透明容器。打开后聚焦首个可用控件，Tab 在弹窗内循环，Escape 或点击遮罩关闭，关闭后恢复之前的焦点；内部对话框阻止点击冒泡。

## Do's and Don'ts

### Do:
- **Do** 复用浅色表面、鼠尾草强调色和现有圆角层级。
- **Do** 为控件保留可见标签、焦点和明确的禁用状态。
- **Do** 保持默认跟随、可固定的工具栏行为。

### Don't:
- **Don't** 将工作台主题写入文章正文或导出 HTML。
- **Don't** 将旧蓝色主题重新引入当前工作台。
- **Don't** 将桌面工作台擅自改为移动端编辑器。

## 素白磨砂修订

大面积底色以 `#f5f4f1` 米白画布与素白面板为主，禁止彩色径向渐变和绿灰晕染。主文字改为中性灰。鼠尾草、薰衣草只用于按钮、选中反馈和封面占位等小面积点缀。

浮层统一 `rgba(255,255,255,.72)`，`blur(28px) saturate(20%)`，使用内侧白色高光和中性投影刻画玻璃边缘；遮罩为中性灰与 14px 模糊。侧栏与顶栏共享白色磨砂表面。未支持 backdrop-filter 时回退 `#fdfdfb`。文章、模板以及导出内容不受界面表面效果影响。
