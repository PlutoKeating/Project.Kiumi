# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Product Purpose
Kiumi 是桌面公众号图文工作台：选择模板、修改内容、导入文档、共享团队文稿，并复制或同步公众号草稿。

## Users
依据现有产品文档：在桌面浏览器制作公众号文章的内容编辑者和团队成员。

## Capabilities and Constraints
React + Zustand + Tailwind，复用 core 渲染与已有团队 API。保留模板、SVG、Word 导入、撤销、本地恢复、团队隔离与微信导出。只做桌面编辑器；不自动发布文章。正文样式独立于编辑器界面。

## Brand Commitments
当前需求指定优雅、清爽、iOS 液态磨砂玻璃、蓝粉与低饱和马卡龙色系，整体柔和明亮。全面重构工作台组件、布局和交互反馈。该要求替代此前的米白/鼠尾草方向；正文与模板原有视觉仍独立于工作台。

## Evidence on Hand
README.md、docs/ARCHITECTURE.md、docs/API.md 与 apps/web 现有实现。当前方向合同在 `.impeccable/surfaces/src-app-tsx.md`。本轮尚在实现和分区验证中，完整设计系统文档与独立视觉审查待完成。
