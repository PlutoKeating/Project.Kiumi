---
name: "Kiumi"
description: "晨光上的 iOS 式磨砂玻璃工作台：小圆角、蓝粉马卡龙，白纸文章与界面彻底隔离。"
colors:
  sky: "#bcd8ff"
  sky-deep: "#2a54a8"
  sky-wash: "rgb(120 170 255 / 16%)"
  blush: "#ffc8de"
  blush-deep: "#9f2f68"
  blush-wash: "rgb(255 130 185 / 15%)"
  lilac: "#d8ccff"
  lilac-deep: "#5639a8"
  mint: "#bff0de"
  mint-deep: "#125f4c"
  mint-wash: "rgb(90 210 170 / 16%)"
  apricot: "#ffdcc2"
  apricot-deep: "#8f4917"
  butter: "#fff0bc"
  ink-900: "#232c4b"
  ink-700: "#3c4668"
  ink-500: "#4c5678"
  ink-placeholder: "#545e82"
  ink-disabled: "#677090"
  hairline: "rgb(92 108 170 / 15%)"
  hairline-strong: "rgb(92 108 170 / 26%)"
  ground: "#f3f5fd"
  paper: "#ffffff"
  glass-fill: "rgb(255 255 255 / 32%)"
  glass-fill-toolbar: "rgb(255 255 255 / 44%)"
  glass-fill-strong: "rgb(255 255 255 / 58%)"
  glass-fill-sheet: "rgb(255 255 255 / 76%)"
  glass-solid: "#f8f8fe"
  glass-edge: "rgb(255 255 255 / 88%)"
  field-fill: "rgb(255 255 255 / 48%)"
  field-fill-focus: "rgb(255 255 255 / 94%)"
  focus: "#5b8cf0"
  selected-wash: "rgb(112 158 255 / 16%)"
  danger: "#a3254f"
  danger-hover: "#a02650"
  danger-wash: "rgb(240 90 140 / 13%)"
  warn: "#744a06"
  warn-wash: "rgb(255 205 110 / 24%)"
  tooltip: "rgb(38 47 84 / 90%)"
  backdrop: "rgb(96 112 180 / 20%)"
  article-ink: "#3f3f3f"
typography:
  sheet-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"MiSans\", \"Noto Sans CJK SC\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-.015em"
  paper-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"MiSans\", \"Noto Sans CJK SC\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-.01em"
  panel-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"MiSans\", \"Noto Sans CJK SC\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-.01em"
  section-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"MiSans\", \"Noto Sans CJK SC\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"MiSans\", \"Noto Sans CJK SC\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"tnum\" 1"
  body-compact:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"MiSans\", \"Noto Sans CJK SC\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"MiSans\", \"Noto Sans CJK SC\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"tnum\" 1"
  code:
    fontFamily: "ui-monospace, \"SF Mono\", \"JetBrains Mono\", Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  xs: "4px"
  thumb: "5px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  island: "14px"
  circle: "50%"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  island: "10px"
  lg: "12px"
  xl: "16px"
  2xl: "24px"
  sheet: "28px"
  top-offset: "66px"
  rail: "68px"
  resource: "356px"
  inspector: "288px"
  paper: "430px"
components:
  button-candy:
    textColor: "{colors.ink-900}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-candy-done:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.mint-deep}"
    rounded: "{rounded.md}"
  button-plain:
    textColor: "{colors.ink-700}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-tint:
    backgroundColor: "{colors.sky-wash}"
    textColor: "{colors.sky-deep}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.danger-hover}"
  icon-button:
    textColor: "{colors.ink-700}"
    rounded: "{rounded.md}"
    size: "34px"
  text-action:
    textColor: "{colors.sky-deep}"
    typography: "{typography.body-compact}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
    height: "28px"
  field:
    backgroundColor: "{colors.field-fill}"
    textColor: "{colors.ink-900}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "38px"
  field-focus:
    backgroundColor: "{colors.field-fill-focus}"
  field-code:
    backgroundColor: "{colors.field-fill}"
    textColor: "{colors.ink-900}"
    typography: "{typography.code}"
    rounded: "{rounded.sm}"
  select-trigger:
    backgroundColor: "{colors.field-fill}"
    textColor: "{colors.ink-700}"
    typography: "{typography.body-compact}"
    rounded: "{rounded.md}"
    height: "32px"
  listbox:
    backgroundColor: "{colors.glass-fill-strong}"
    textColor: "{colors.ink-700}"
    rounded: "{rounded.md}"
    padding: "6px"
  search:
    backgroundColor: "{colors.field-fill}"
    textColor: "{colors.ink-500}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  segmented:
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-item:
    textColor: "{colors.ink-500}"
    typography: "{typography.body-compact}"
    rounded: "{rounded.thumb}"
    padding: "0 12px"
    height: "28px"
  chip-filter:
    textColor: "{colors.ink-500}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  rail-item:
    textColor: "{colors.ink-500}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "60px"
  capsule:
    backgroundColor: "{colors.glass-fill}"
    rounded: "{rounded.lg}"
    padding: "0 6px"
    height: "46px"
  island:
    backgroundColor: "{colors.glass-fill}"
    rounded: "{rounded.island}"
  dock:
    backgroundColor: "{colors.glass-fill}"
    rounded: "{rounded.island}"
    padding: "0 6px"
    height: "58px"
  block-toolbar:
    backgroundColor: "{colors.glass-fill-toolbar}"
    textColor: "{colors.ink-700}"
    typography: "{typography.body-compact}"
    rounded: "{rounded.island}"
    padding: "6px 8px"
  pop-menu:
    backgroundColor: "{colors.glass-fill-strong}"
    rounded: "{rounded.lg}"
    padding: "6px"
  sheet:
    backgroundColor: "{colors.glass-fill-sheet}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.island}"
  toast:
    backgroundColor: "{colors.glass-fill-strong}"
    textColor: "{colors.ink-900}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
  tooltip:
    backgroundColor: "{colors.tooltip}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "4px 9px"
  template-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.md}"
  paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.article-ink}"
    rounded: "{rounded.island}"
    padding: "28px 20px 132px"
    width: "430px"
---

# Design System: Kiumi

## Overview

**Creative North Star: "晨光温室，克制的 iOS 磨砂"**

全屏柔光（天蓝、樱粉、丁香、薄荷、杏色）铺在最底层，上面漂浮通透的磨砂面板，靠强模糊、顶边细高光和层次投影分层。文章是中央的一张白纸：所有工具都是纸外的玻璃，文章从玻璃下穿过。这里是操作型工具，密度紧凑、字阶固定，没有营销式的大标题，也没有展示字体。

这个世界经过两次校准。用户先说「过于拟物化了，希望应当是扁平风的磨砂玻璃质感」「减小圆角半径，看起来略微专业一点」，折射环、镜面与指针高光、球体、胶囊控件和弹簧因此被移除；看过扁平版后又要求「再增强一点iOS拟态磨砂玻璃质感」，于是加回通透度、顶边细高光和层次投影。目标是两者之间：有 iOS 玻璃的质感，但小圆角、克制、专业。

系统只约束工作台外壳。文章 HTML、模板预览和导出内容有自己的样式，界面主题不得进入其中。只面向桌面浏览器。

**Key Characteristics:**

- iOS 式磨砂薄片：通透填充、强模糊、顶边细高光、层次投影；质感克制，不做球面和粗边。
- 小圆角且同心：面板 14px，控件 8px，内层再减。
- 每个资源分区一种马卡龙光色，环境光随分区缓慢变换。
- 全局只有一种选中标记，在导航、分段控件和筛选标签之间平滑滑动。
- 动效只走 ease-out，只表达状态，什么都不回弹。

## Colors

低饱和马卡龙浮在冷白底上，深靛墨承担阅读；浅色负责光，深色搭档负责字。

### Primary

- **晴空蓝** (`sky` #bcd8ff)：模板分区光色，也是环境光默认色和糖果渐变的起点。
- **操作深蓝** (`sky-deep` #2a54a8)：文字操作、光标、复选框、列表当前项、按下的工具按钮；语义上就是 action。
- **晨雾蓝底** (`sky-wash`)：浅蓝按钮的底、文字操作的悬停底。
- **焦点蓝** (`focus` #5b8cf0)：键盘焦点、选中内容块、卡片悬停轮廓、拖放落点。只作线和轮廓，不作文字色。
- **选中蓝底** (`selected-wash`)：菜单和工具按钮的悬停底、提示条底。

### Secondary

- **樱粉** (`blush` #ffc8de) 与 **樱粉深** (`blush-deep` #9f2f68)：收藏分区。已收藏的星标用樱粉填充、樱粉深描线；`blush-wash` 是收藏操作的底。
- **糖果渐变**（`--candy`，100° 从 #bcd8ff 到 #ffcbe0，悬停 `--candy-hover`）：蓝粉双主色的唯一控件形态，全屏只给「复制到公众号」这一个主操作。Dock 和其他按钮不得使用。

### Tertiary

- **丁香** (`lilac`) / `lilac-deep`：图库分区、Dock 的正文工具、导入区图标、头像底。
- **薄荷** (`mint`) / `mint-deep` / `mint-wash`：素材分区，同时是成功语义（已保存、已复制、可以发布、同步成功）。
- **杏色** (`apricot`) / `apricot-deep`：Dock 的分割线工具；剪贴板分区的激活图标用 `apricot-deep`。
- **奶油** (`butter`)：剪贴板分区的光色。它没有自己的深色，这一分区的图标借用 `apricot-deep`。

### Neutral

- **深靛墨** (`ink-900` #232c4b)：标题、输入内容、当前项。永远不用纯黑，玻璃才软得下来。
- **次级墨** (`ink-700`)：控件默认文字。**弱墨** (`ink-500`)：次要说明、计数、未选导航。**占位墨** (`ink-placeholder`)：只给 placeholder。
- **细线** (`hairline` / `hairline-strong`)：分隔线、字段描边、列表界线；strong 用于字段悬停和拖放区。
- **底色** (`ground`)：环境光下的基底。**白纸** (`paper`)：文章、模板预览和缩略图的底。
- **玻璃填充** (`glass-fill` 32%、胶囊与 Dock 30%、`glass-fill-toolbar` 44%、`glass-fill-strong` 58%、`glass-fill-sheet` 76%)：岛和胶囊、跟随工具条、弹出层、弹窗，越靠上层越实。**玻璃回退** (`glass-solid`)：浏览器不支持 backdrop-filter 时使用。**玻璃边** (`glass-edge`)：四周均匀的 1px 细边。
- **状态** (`danger` / `danger-hover` / `danger-wash`、`warn` / `warn-wash`)：破坏性操作和发布前警告，文字色在对应浅底上保持可读。
- **工具提示墨** (`tooltip`)、**遮罩** (`backdrop`)：工具提示底和弹窗遮罩。
- **文章墨** (`article-ink` #3f3f3f)：文章默认字色，属于文章，不属于界面。

### Named Rules

**The 一区一光 Rule.** 每个资源分区只有一种光色：模板 sky、素材 mint、收藏 blush、剪贴板 butter、图库 lilac。切换分区时 `--tint` 用 900ms 渐变，环境光、选中标记、筛选标记和空状态图标底一起换色；新增分区必须先定它的光色。

**The 深色搭档 Rule.** 每种马卡龙光色都有同族深色。实色浅底上的小字用 `ink-900`，或用已过 4.5:1 的配对（`mint-deep` 配 `mint`、`lilac-deep` 配 `lilac`）；`blush-deep`、`apricot-deep`、`sky-deep` 压实色同族只有 3.9–4.2:1，只放图标。深色小字放在 wash 底上。

**The 文章色不是界面色 Rule.** `ArticleSettings.tsx` 的六个主题色和 `ui.tsx` 的十六色调色板是写进文章的颜色，`article-ink` 也一样。它们不是界面 token，不得用来给工作台外壳着色；反过来，界面 token 也不得写进文章。

## Typography

**UI Font:** `-apple-system`、BlinkMacSystemFont、"SF Pro Text"、"PingFang SC"、"HarmonyOS Sans SC"、"MiSans"、"Noto Sans CJK SC"、"Microsoft YaHei UI"、"Microsoft YaHei"（完整栈见 frontmatter）
**Code Font:** `ui-monospace`、"SF Mono"（回退 "JetBrains Mono"、Menlo、monospace）

**Character:** 跟随操作系统的中文无衬线，清爽且不抢文章的戏；不加载网络字体，没有 display 层级。全局开启表格数字（`tnum`），保存时间、计数和缩放值不跳动。

### Hierarchy

- **Sheet title**（650，24px，1.3）：弹窗标题，界面里最大的一级。
- **Paper title**（650，22px，1.4）：白纸上的文稿标题字段。
- **Panel title**（650，18px）：资源面板标题、空白纸面标题。
- **Section title**（650，15px）：检查器和弹窗内的分组标题；同一字号 600 用于拖放区主文案。
- **Body**（400，13px，1.5）：按钮、字段、菜单、提示条，是工作台的默认字号。按钮用 500，主按钮和当前项用 600。
- **Body compact**（400，12px，1.5）：工具条、次要操作、字段标签、说明文字。
- **Label**（400，11px，1.5）：导航和 Dock 的图标标签、卡片名称、工具提示、字数计数。
- **Code**（400，12px，1.55）：只用于 HTML 源码字段。

品牌词 Kiumi 在顶部以系统圆体 `--font-brand` 的 15px、700 呈现，只属于标志，不是可复用的字体角色。

### Named Rules

**The 固定字阶 Rule.** 字号只有 11、12、13、15、18、24px 这六档 token，外加白纸标题的 22px。不用流式字号，不新增中间值，层级优先用字重和墨色表达。

**The 等宽只写代码 Rule.** `ui-monospace` / "SF Mono" 只出现在 HTML 源码字段。数字、色值、标签都不用等宽字体扮演「技术感」。

## Layout

验收视口是桌面 1280、1440、1920，以及矮窗口 1280×680。不做移动端。

页面不滚动，所有东西悬浮在全屏环境光上。顶部三段浮动胶囊（高 46px，距顶 10px）：左为品牌与团队，中为文稿标题、保存、撤销重做，右为预览、公众号草稿、主操作、更多、头像。中段按白纸的视觉中心定位，而不是窗口中心。

胶囊之下是三栏：资源岛（68px 导航 + 288px 资源，共 356px，收起时只留 68px）、中央画布、检查器岛（288px）。岛与窗口、岛与岛的间距都是 10px，岛的顶部让出 66px。画布贴到底，上下边缘用 14px 遮罩渐隐，白纸 430px 宽，在其中独立滚动，缩放范围 50–140%。Dock 在画布底部居中悬浮（距底 20px，矮窗口 14px）。

宽度适配只调两侧岛：≥1680px 为 404 / 320px，≤1360px 为 320 / 262px 且收紧工具条和 Dock。≤1130px 的规则只是防破版，不在验收范围内，也不构成窄屏承诺。高度 ≤700px 时弹窗外边距从 32px 收到 20px，内部留白和粘贴框同步缩小。

间距步长为 2、4、6、8、10、12、16、24px，弹窗水平内边距 28px。紧凑是常态：控件之间 2px，组内 8px，分区 12–16px。

**The 不换行工作台 Rule.** 长文章标题和内容只能截断，不能撑宽面板。网格列用 `minmax(0, 1fr)`，1280 宽下跟随工具条保持一行。

## Elevation & Depth

深度来自四件事：环境光、一层磨砂、顶边细高光、两层投影。所有玻璃面共用 `--glass-blur`（`blur(32px) saturate(200%)`，弹窗用更重的 `--glass-blur-sheet`（`blur(44px) saturate(180%)`））、1px 均匀玻璃边和按层级递增的填充不透明度；不支持 backdrop-filter 时回退到 `glass-solid`。弹窗几乎不透明，避免长表单被背景干扰；遮罩是 `backdrop` 加 `blur(10px) saturate(130%)`。

层级从低到高：跟随块快捷工具 5、岛 10、Dock 30、跟随工具条 35、顶栏 40、右键菜单 45、弹出菜单 50、弹窗 60、Toast 65、工具提示 80、下拉列表 90。

### Shadow Vocabulary

每条投影都有偏移，并带环境光的靛蓝，不用纯黑。

- **Island**（`0 14px 34px -20px rgb(74 92 170 / 36%), 0 2px 6px -4px rgb(74 92 170 / 12%)`）：所有玻璃面的默认投影。
- **Float**（`0 18px 40px -18px rgb(66 82 160 / 42%), 0 3px 8px -5px rgb(66 82 160 / 16%)`）：中间胶囊、Dock、跟随工具条、菜单、列表、Toast。
- **Sheet**（`0 28px 70px -30px rgb(58 72 150 / 42%)`）：弹窗。
- **Paper**（`0 16px 44px -28px rgb(78 96 176 / 34%)`）：白纸，让它从光里浮出来。
- **Chip**（`0 1px 3px rgb(66 82 160 / 14%)`）：选中标记和大纲选中行，是最小的一档。

### Motion

一条曲线 `--ease-out`（`cubic-bezier(.16, 1, .3, 1)`，无过冲），三档时长：150ms 用于颜色和描边，220ms 用于弹出和淡入，420ms 用于滑动、弹窗入场和岛的展开。一切位移和缩放都减速落定；纯颜色和透明度的淡变可以用 `ease`。环境光换色 900ms、加载微光 1.5s 线性循环是仅有的两个例外。按下缩到 .97。减少动态偏好下关闭动画，过渡缩短到 1ms。

### Named Rules

**The 整体缩放 Rule.** 界面用根级 `zoom`（`--ui-scale`）等比放大：窗口 ≤1360 为 1.04，常规 1.08，≥1800 为 1.1。文中所有 px 都是缩放前的值。按测量定位的浮层必须走 `lib/ui-scale.ts`，视口单位必须用 `--vh`、`--vw`，否则位置和高度都会偏移。

**The 看得清 Rule.** 对比度按屏幕实际像素算，不按色值算：`pnpm --filter @kiumi/web audit:contrast` 在全部状态里实测每段文字和图标，正文 ≥4.5，大字和图标 ≥3，禁用 ≥3，含深色与高饱和文章压在玻璃下的压力状态。禁用用 `--ink-disabled` 换色，不用 opacity 变淡。中间胶囊、Dock、工具条、Toast 和所有菜单用 `--glass-blur-float` 提亮背后的深色内容，中间胶囊和 Dock 的次要文字比面板深一档；11px 的安静文字用 `ink-700`。提示气泡不得盖住已打开的菜单。

**The 克制玻璃 Rule.** 玻璃是一块有光泽的薄片：通透填充、强模糊、顶边 1px 细高光、顶部 56px 淡光、两层靛蓝投影，到此为止。质感只在边缘和顶部出现，任何暗示球面、粗厚边缘或随指针移动的光都不属于这个世界。

**The 模糊放伪层 Rule.** 模糊和细边都放在 `::before` 上，不放在元素自身。元素自身带 backdrop-filter 时，溢出的菜单只能采样父级而不是页面；放到伪层，菜单才能模糊到真实的页面内容。新的玻璃面必须沿用这个结构，并加入 `isolation: isolate`。

**The 只落不弹 Rule.** 动效走 ease-out，只表达状态。曲线不得过冲，关键帧不得越过终点，动效不做装饰。

## Shapes

圆角小而同心：外层减内边距等于内层。岛 14px 减 6px 内边距，得到内部控件 8px；分段控件轨道 8px 减 3px，得到滑块 5px。阶梯为 4（小文字操作、列表项）、5（分段滑块）、6（字段、工具按钮、菜单项）、8（按钮、卡片、下拉）、10（顶部胶囊、弹出菜单）、14（岛、Dock、弹窗、白纸）。

圆形只给天然是圆点的东西：头像、色板、颜色圆点、状态点，全部扁平填色。线性图标是一套自绘 SVG：24 网格、1.7 描边、圆头，`currentColor` 上色；收藏星标是唯一带填充的图标。

**The 小而同心 Rule.** 控件不超过 10px，容器不超过 14px，不得出现胶囊形控件。新容器按「外层减内边距」推算内层圆角，不要凭感觉取值。

## Components

### Buttons

- **Shape:** 8px 圆角，默认高 36px；紧凑场景降到 32 或 30px。
- **糖果主按钮:** 蓝粉渐变配深靛墨字（600），绝不用白字；完成后切换为 `mint` 底、`mint-deep` 字，1.8 秒后恢复。全屏只有一个。
- **普通按钮:** 透明底，悬停时铺 62% 白。
- **浅蓝按钮:** `sky-wash` 底、`sky-deep` 字，用于低强调的正向操作。
- **危险按钮:** `danger` 实底白字，只用于确认后的破坏性操作；列表里的删除默认是弱墨文字，悬停才显红。
- **图标按钮:** 34×34px，悬停铺 66% 白；`is-soft` 加字段底和细线。
- **文字操作:** 高 28px、4px 圆角、`sky-deep` 字。
- **Hover / Focus:** 颜色 150ms 过渡，按下 `scale(.97)`。全局焦点为 2px `focus` 轮廓、外移 2px。禁用用 `ink-disabled` 换色，不用透明度变淡。

### Chips

- **分段控件:** 13% 靛蓝轨道、3px 内边距，白色滑块用共享选中标记。
- **筛选标签:** 透明底，当前项用 58% 分区光色的选中标记，字变 `ink-900` 600。这里的颜色跟着分区走。

### Cards / Containers

- **模板卡片:** 两列，4:4.6 比例，白底、8px 圆角、1px 细线环绕。卡片内是沙箱 iframe，以两倍尺寸渲染再缩到 .5，文字比例才真实；预览永不截获指针。悬停或键盘聚焦时轮廓换成 1.5px `focus`，操作条从下方 5px 升起，星标淡入。
- **收藏卡片、剪贴板条目:** 62% / 58% 白底，1px 内描边，圆角 8px。
- **状态面板:** 加载、空白、错误各有独立形态。图标底用当前分区光色，错误时用 `danger-wash`，有下一步时给出按钮。

### Inputs / Fields

- **Style:** 48% 白底、1px 内描 `hairline`、6px 圆角，最小高 38px。textarea 随内容增长，上限 280px。
- **Focus:** 底色升到 94% 白，1.5px 内描 `focus`，外加 4px 16% 蓝色光晕。搜索框用 `focus-within` 复用同一处理。
- **Error / Disabled:** 错误用 `danger-wash` 底的提示块，不改字段本身；禁用用 `ink-disabled`。
- **HTML 源码字段:** 使用 Code 字形，可纵向拖拽，是全系统唯一的等宽文本。
- **下拉:** 自绘 combobox，通过 portal 脱离滚动容器。默认 8px、高 32px，表单内用 `is-field` 与字段对齐，工具条内用 `is-chip`。列表保持键盘导航，放不下时向上翻转。

### Navigation

- **资源导航:** 68px 宽的竖轨，与资源面板是同一块玻璃，只用右侧细线分开。图标 21px 加 11px 中文标签。
- **状态:** 当前项由 62% 分区光色的选中标记表达，图标换成分区深色，字变 `ink-900` 600，并带 `aria-current`。
- **检查器:** 三段分段控件（内容 / 大纲 / 图文）。发布前有问题时旁边出现 `warn` 计数徽标。

### 选中标记

全局唯一的选中形态，也是系统的招牌。一枚扁平标记用 420ms ease-out 滑到当前项，同时过渡位置和尺寸；首次出现不播动画，容器尺寸变化时重新定位。由 `useDroplet` + `Droplet` 提供，导航、分段控件和筛选标签共用。

**The 唯一选中标记 Rule.** 切换器不得另造选中样式，新的切换器必须复用这枚标记。

### 跟随工具条

跟随选中内容块的玻璃条，单行，44% 填充，可固定到顶部。菜单同一时间只开一个，向空间更大的一侧展开，宽菜单 372px 两列。

### Dock

底部居中的插入条，每个工具 50×50px，图标在上标签在下。悬停时铺 50% 工具色，图标变同族深色；静止时只有墨色，马卡龙只在悬停时铺开。

### 菜单与工具提示

- **弹出菜单 / 右键菜单:** 58% 玻璃、10px 圆角、6px 内边距，项高 34–36px，悬停 `selected-wash`。
- **工具提示:** 深靛实底白字，不做玻璃，在任何背景上都要读得清。悬停 380ms 后才显示，扫过工具条时保持安静。

**The 提示不进名字 Rule.** 工具提示的文字由 CSS 生成内容 `attr(data-tip)` 产生，而生成内容会计入按钮的可访问名称。带 `data-tip` 的文字按钮必须同时写 `aria-label`，否则读屏会把快捷键提示读进名字。

### 弹窗

- **结构:** 通过 portal 挂到 body，宽度 660 / 860 / 430px，最大高度为视口减 64px，内容在内部滚动。
- **入场:** 从下方 18px、.97 缩放落定，420ms。
- **焦点:** 打开时聚焦首个可用控件，Tab 循环，关闭后归还焦点，Escape 关闭。
- **就地确认:** 删除和解绑在原位展开 `danger-wash` 确认块，Escape 只退出确认，不连带关闭弹窗。

### 文章画布

白纸 430px 宽、14px 圆角、`paper` 投影。选中块用 1.5px `focus` 轮廓加 5px 光晕，悬停只有 1px 淡线，拖放落点是 3px 蓝线。空槽位的提示文字只在编辑器里出现，不进入导出。

**The 正文隔离 Rule.** 文章在工作台里必须与导出的样子一致。Tailwind 的 preflight 被有意排除，只引入 theme 和 utilities；外壳 reset 用 `:where()` 写成，在 `[data-block-content]` 处停止。`ARTICLE_CSS`（`src/lib/article-context.ts`）是唯一的阅读语境：缩略图、收藏和预览的 iframe 直接使用它，画布和导入预览由 `styles.css` 的镜像规则对齐，两边必须同步修改。

### Toast

玻璃小条，出现在 Dock 上方，不抢焦点。成功图标 `mint-deep`，错误图标 `danger`。

## Do's and Don'ts

### Do:

- **Do** 让所有新玻璃面走 `::before` 结构，复用 `--glass-blur`、`--glass-edge` 和分层填充。
- **Do** 按「外层减内边距」推算圆角，控件不超过 10px，容器不超过 14px。
- **Do** 位移和缩放只用 `--ease-out`，时长取 150、220、420ms。
- **Do** 新切换器复用共享选中标记，新分区先定光色。
- **Do** 让小字满足 4.5:1：实色马卡龙上用 `ink-900`，深色搭档放在 wash 底上；投影带靛蓝并有偏移。
- **Do** 给带 `data-tip` 的文字按钮写 `aria-label`。
- **Do** 改文章阅读样式时同时更新 `ARTICLE_CSS` 和 `styles.css` 的镜像规则。
- **Do** 在 1280、1440、1920 和 1280×680 下检查滚动、工具条和弹出层边界。

### Don't:

- **Don't** 给玻璃加折射环或粗描边。玻璃边只有 `glass-edge`：顶边 1px 高光加四周 1px 淡边，字段的 `hairline` 内描不算高光。
- **Don't** 加跟随指针的高光或大面积镜面反光。顶部 `glass-sheen` 是唯一的光泽层；加载骨架的微光是状态信号，不在此列。
- **Don't** 做球体、水泡或任何带明暗体积的形状。圆形只能扁平填色。
- **Don't** 用胶囊形控件。顶部「胶囊」只是名字，实际是 10px 圆角。
- **Don't** 用弹簧、回弹或过冲曲线，也不要让关键帧越过终点。
- **Don't** 用纯黑做文字或投影。
- **Don't** 把糖果渐变用到主操作以外的控件上，也不要用白字压在上面。
- **Don't** 把等宽字体用到 HTML 源码字段以外的地方，也不要新增网络字体。
- **Don't** 把主题色板或调色板的颜色当界面色，也不要把界面 token 写进文章、模板预览或导出 HTML。
- **Don't** 恢复 Tailwind preflight，或让外壳 reset 越过 `[data-block-content]`。
- **Don't** 把工作台改成移动端编辑器。
