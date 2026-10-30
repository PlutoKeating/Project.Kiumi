---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components"]
---

# 编辑工作台

Mode: Operate。为桌面公众号编辑者服务；保留模板、素材、团队、导入、撤销和导出功能。用户已经明确指定蓝粉 iOS 液态磨砂玻璃，直接采用此方向，code-led 实现。

## Direction contract

THESIS: 内容始终是主角；浏览、编排、调整、交付四类操作各有位置，替换当前满行小按钮和绿色皮肤。

OWN-WORLD: 冷白底、浅蓝导航、粉色收藏点缀；深蓝墨色文字。玻璃高光边缘与柔和有方向投影表达浮层，表单用稳定的半实色底确保可读。系统中文字体，统一线性图标。

STORY: 左侧挑选内容，中间白纸编排，右侧检查结构；常用插入紧靠画布，文稿保存和复制在顶栏，更多交付操作渐进展开。

FIRST VIEWPORT: 1440×900 桌面。顶部文稿与交付操作，第二行插入和撤销；76px 导航、280px 素材、弹性画布、260px 检查器。主要动作「复制到公众号」始终可见。粉色用于收藏，蓝色用于当前项与主要动作。选中内容出现磨砂跟随工具栏，展开菜单以轻微位移和阴影变化反馈层级。

FORM: 用户指定方向优先于随机候选。seed:1079beb0dedc0dad。code-led；保持桌面工作台熟悉的操作结构，不引入装饰性卡片墙。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Pending verification
所有资源面板、内容工具菜单、导入、团队、公众号、预览；1280/1440/1920 桌面与较低高度；键盘、空/错/加载态、减少动画和无磨砂回退。
