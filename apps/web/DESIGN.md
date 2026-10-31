---
name: "Kiumi"
description: "蓝粉液态磨砂玻璃桌面图文工作台；文章白纸与界面主题隔离。"
colors:
  primary: "#3e68ad"
  focus: "#6087c5"
  action-hover: "#335c9e"
  action-surface: "#e6eefb"
  collection: "#8d5276"
  collection-surface: "#fae9f0"
  ink: "#28364b"
  ink-strong: "#374962"
  ink-secondary: "#4d5e75"
  muted: "#617087"
  placeholder: "#65748a"
  field: "#f7f9fd"
  mist: "#eff3fa"
  border: "#dce3ef"
  ground: "#f0f4fa"
  glass: "rgba(255, 255, 255, .72)"
  white: "#ffffff"
  selected: "#dce9fc"
  selected-ink: "#254674"
  hover: "#e8effb"
  danger: "#963a56"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-.025em"
  panel-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    fontWeight: 600
  field:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif"
    fontSize: "13px"
    lineHeight: 1.6
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif"
    fontSize: "11px"
rounded:
  field: "8px"
  control: "10px"
  card: "12px"
  navigation: "14px"
  overlay: "16px"
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
    padding: "8px 18px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "#ffffffa8"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-tool:
    rounded: "{rounded.field}"
    padding: "5px 8px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "#354861"
    typography: "{typography.field}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
  filter:
    backgroundColor: "rgb(62 104 173 / 10%)"
    textColor: "{colors.primary}"
    padding: "2px 6px"
  template-card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.card}"
    height: "224px"
  toolbar:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.overlay}"
    padding: "8px"
  dialog:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.overlay}"
---

# Design System: Kiumi

## Overview

**Creative North Star: "蓝粉玻璃编辑台"**

冷白工作区承载浅蓝操作反馈与粉色收藏点缀，深蓝墨色让紧凑控件保持清楚。半透明表面、内侧高光与柔和投影构成用户指定的 iOS 液态磨砂玻璃语言；表单保持稳定的浅色或白色底。

本文从 `src/tokens.css`、`src/styles.css` 的最终层叠与现有组件提取，替代原鼠尾草方案。系统只约束桌面工作台外壳；文章白纸、模板 HTML、SVG 和导出内容保留自身样式。没有新增字体、图片资产或运行时依赖。

**Key Characteristics:**

- 蓝色表示操作与选中，粉色表示收藏和少量辅助反馈。
- 玻璃高光、柔和阴影与清楚的键盘焦点。
- 紧凑桌面多栏，白色文章画布独立于外壳。

## Colors

冷白、浅蓝和柔粉构成低饱和底色，深蓝墨色承担阅读；精确颜色以 frontmatter 与源码 tokens 为准。

### Primary

主色用于复制到公众号、主要提交、插入与选中反馈；focus 用于键盘轮廓，action-hover 用于顶栏主按钮悬停。action-surface、selected 与 hover 分别服务浅色操作面、选中区域和工具悬停。

### Secondary

collection 与 collection-surface 用于收藏导航及复用操作。危险确认使用 danger 与明确文案；不把粉色收藏自动解释为危险。

### Neutral

ink 系列区分主文案、次级内容和辅助标签；field、mist、border 与 ground 区分字段、浅底、分隔线和页面底。glass 为共享浮层材质，white 为文章白纸与预览背景。背景渐变属于外壳材料，不是文章底色。

**The 正文隔离 Rule.** 界面主题不得覆盖文章 HTML 的文字、背景和模板样式，也不得进入导出正文。

**The 颜色有职 Rule.** 蓝色承担主要操作与当前状态，粉色承担收藏；危险操作通过独立危险色、文案和确认状态区分。

## Typography

**Body Font:** 系统无衬线与中文系统回退（完整栈见 frontmatter）。没有单独的展示字体或营销大标题层级；品牌文字是紧凑工作台标识，不是可复用 display 样式。

### Hierarchy

- **Title:** 弹窗标题，使用 title；正文内容仍由模板决定。
- **Panel title:** 面板和图文设置标题，使用 panel-title。
- **Field:** 摘要等输入文字，使用 field；图文标题字段单独为 15px、500 字重。
- **Body:** 面板说明和常规操作以 12px 为主，说明段落行高 1.6；状态说明可用 1.8。
- **Label:** 紧凑字段与导航标签使用 label；类型、计数等辅助信息局部使用 10px，不推广为正文大小。

字号按任务密度分工，没有等比字号阶梯。图标复用线性 SVG，保留文字标签与可访问名称。

## Layout

只面向桌面浏览器，验收宽度为 1280、1440、1920。导航宽 76px；资源面板默认 360px、检查器默认 292px；1251–1440px 时分别为 280px、260px。已有 ≤1250px 紧凑规则把两栏收至 250px，并缩小画布左右留白；这不构成移动端支持承诺。

顶栏文稿操作行至少 68px，第二操作行至少 56px，后者可横向滚动。资源面板与检查器上下留 12px；中间画布弹性占用剩余空间并独立滚动。纸张基准宽 430px、最小高 720px，随画布缩放；纸张内部左右 20px、上下 24px。图文设置为 80px 封面加弹性字段列，间距 16px，展开字段双列排列。

间距以 4/8/12/16/24px 为常用步长，组件局部保留紧凑 2px、6px 间隔。跟随工具栏宽为画布宽减 24px、上限 710px，左右至少留 12px；菜单受可用高度限制并可向上展开。弹窗通常外留 32px，最大宽高为视口减 64px；窗口高 ≤700px 时外留 20px、最大高度为视口减 40px，内容内部滚动。

## Elevation & Depth

共享玻璃为 glass 表面，使用 `blur(28px) saturate(135%)`。工具栏独立伪元素承载模糊，使越界菜单仍能模糊底下内容。顶栏与侧栏使用内侧高光；工具栏、菜单和模态框增加蓝灰投影。外壳底为从浅蓝经冷白到浅粉的线性渐变。浏览器不支持 backdrop-filter 时，界面玻璃回退为稳定浅白（#f9fbff）。

### Shadow Vocabulary

- **Highlight:** 内侧顶边高光及细亮边；精确值见 sidecar。
- **Float:** 高光加轻柔向下投影，用于工具栏、菜单与右键菜单。
- **Modal:** 高光加更宽、更深的投影，用于对话框。
- **Paper:** 白纸柔和外阴影（`0 8px 30px rgba(18,21,28,0.10)`），与玻璃浮层区分。

模态遮罩为蓝灰半透明层，模糊 12px、饱和度 110%；工具栏 z-index 为 35，顶栏和右键菜单为 40，模态遮罩为 60。控件背景、边框与阴影用 150ms ease 过渡；模板卡片悬停为 180ms ease。工具菜单及对话框使用 200ms reveal，从下方 6px 进入；减少动态偏好关闭动画与过渡。

**The 玻璃可读 Rule.** 磨砂只服务于界面表面；字段和正文保持稳定底色，不用透明度替代文字对比。

sidecar 的 8 阶 tonalRamp 只为文档面板合成预览，不是生产颜色 token，不得直接据此增加界面色阶。

## Shapes

字段与工具按钮通常用 field 圆角；文稿按钮用 control，卡片用 card，导航按钮用 navigation，面板、工具栏和对话框用 overlay。保留局部输入框 7px/9px 的既有变体，不强行统一。分隔线轻且细；文章纸张为 12px 圆角。选中内容块使用蓝色 1.5px 轮廓、外移 4px；颜色选择器为圆形。

## Components

### Buttons

清楚、轻盈且可辨状态。文稿按钮最小高 36px，主按钮左右内边距 18px、普通按钮 12px；主按钮蓝底白字，次按钮半透明白底加内描边。工具栏按钮至少 32×32px，操作行按钮至少高 34px，模态按钮至少高 36px。悬停、按下、展开与禁用各有反馈；禁用通常降低透明度并显示不可用光标。全局键盘焦点为 2px 蓝色轮廓、外移 3px，工作台与弹窗字段外移 2px。

### Chips

推荐模板与最近使用为紧凑筛选按钮，选中使用 10% 主色底与主色文字、aria-pressed；资源面板按钮至少高 32px。分类使用带可访问名称的原生选择框，避免悬停菜单被滚动裁切。

### Cards / Containers

模板卡片两列展示，高 224px、预览区高 144px、名称行高 32px。白底、柔和边框、card 圆角；悬停提升边框与投影。预览通过独立 iframe 呈现模板自身样式，不截获指针；覆盖预览的插入按钮、文字「插入」与「应用样式」分别提供明确动作，未选内容时禁用应用样式。收藏使用独立预览、标题和操作区，剪贴板用紧凑列表；不把所有内容都放进同一种卡片。

### Inputs / Fields

字段保留可见标签，浅色或白色底、细边框和清楚焦点。摘要可纵向缩放，更多图文设置默认折叠；团队和公众号表单主要输入最小高 40px。异步提交禁用重复操作及相关切换；可关闭弹窗依旧接收 Escape。状态面板分别提供加载骨架、空状态下一步、错误与重试。

### Navigation

导航为浅蓝玻璃，按钮宽 64px、最小高 60px，图标与中文标签纵向排列。当前项通过 aria-current、浅白面与投影区别；收藏当前项为粉色底与收藏色文字。检查器目录显示内容摘要与中文类型，使用可键盘选择的按钮；所选内容的排序、复制、删除在独立操作行，首尾移动禁用。

### 跟随工具栏

默认跟随选中块，可固定到画布上方；非固定且选中块滚出视野时隐藏。工具栏通过 portal 定位，两排操作可折行；菜单一次只展开一个，切换块、点击外部或 Escape 关闭。菜单向下或向上打开并内部滚动，避免离开视口。编辑沿用原有撤销状态；收藏保存完整块内容及样式，独立于块剪贴板。

### Modal / 就地确认

弹窗通过 portal 挂到 document.body；打开聚焦首个可用控件、Tab 循环、关闭恢复焦点。Escape 与遮罩可触发关闭，但具体业务的 busy 状态可限制关闭。删除文稿、解除绑定在原位置显示问题及取消/确认按钮；取消优先聚焦，Escape 只退出该确认，不连带关闭父弹窗。预览 iframe 始终保持白底，其高度受视口限制。

## Do's and Don'ts

### Do:

- **Do** 复用蓝粉语义色、玻璃材质和现有圆角层级。
- **Do** 保留可见字段标签、键盘焦点、明确禁用状态以及加载、空白、错误的区别。
- **Do** 保持工具栏默认跟随、可固定以及弹窗的焦点管理。
- **Do** 在 1280、1440、1920 桌面宽度和较低窗口高度检查滚动与浮层边界。

### Don't:

- **Don't** 将工作台主题写入文章正文、模板预览或导出 HTML。
- **Don't** 恢复已被替代的鼠尾草主色与低饱和度灰绿玻璃规范。
- **Don't** 将桌面工作台擅自改为移动端编辑器，或引入额外字体和装饰图片。
- **Don't** 把请求错误显示成空面板，或把删除、解除绑定藏在无解释的图标后。
