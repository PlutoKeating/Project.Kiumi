# 桌面工作台

React + Zustand。顶栏「团队与文稿」提供创建/加入/切换团队、成员邀请、文稿打开与删除。文稿和图库随团队共享，收藏、最近使用及块剪贴板只保存在本机。

`api.ts` 为请求附带当前团队；`store.ts` 按用户和团队分别自动保存本地恢复副本。云端保存使用当前团队，切换团队清空撤销历史。浏览器登录使用现有身份服务。

模板块可携带原始 HTML，保留 SVG 与复杂布局；文字/图片槽位编辑同步更新 HTML。复制与导出使用服务端渲染结果。

运行 `pnpm build:web` 构建，生产由 `apps/edge` 部署。只针对桌面浏览器开发。

## 导入与 SVG

「导入内容」支持 DOCX、Word/WPS 富文本粘贴、图片 ZIP、Markdown、HTML 和公开网页。DOCX 通过 Mammoth + JSZip 在浏览器解析，按标题、段落、图片、完整列表和表格分块；先预览、调整标题并确认问题，再上传团队图片并写入画布。图片总量 80 MiB，单张 10 MiB，带图导入需要登录团队。HTML/网页保留原有布局与 SVG 导入行为。

复杂公式、图表、页眉页脚等的处理边界见 [Word 导入说明](../../../docs/WORD_IMPORT.md)。浏览器回归运行 `pnpm --filter @kiumi/web test:import`；支持以环境变量提供不入库的本机样本。

记录 HTML 的块在右侧按实际 DOM 提供文字、图片、颜色和动画参数编辑；源码编辑可处理任意 SVG 参数。画布双击编辑与输出使用同一份 HTML。

「公众号草稿」可管理多个团队公众号，选择图库封面并保存、同步、回读草稿。创建者配置凭证，成员可使用团队公众号。

多选使用 Ctrl/Command 或 Shift 点击；批量操作在右侧面板。Ctrl/Command+A 全选，C/V 复制粘贴，D 克隆，Delete 删除；Ctrl/Command +/-/0 与滚轮调节画布缩放。Alt 拖动可将块放入目标模板容器。模板图片支持上传或选择团队图库，链接也可直接编辑。

## 本地优先与模板换样式

`store.refresh` 使用 core 同步渲染和编辑态校验；`catalog-cache.ts` 负责公开模板的内存去重、Cache Storage、后台更新与 ETag；`catalog-index.ts` 持久化完整分类目录；`catalog-sync.ts` 后台单路下载全库记录并支持暂停。`public/catalog-assets-sw.js` 只缓存同源 `/assets/` 图片，不处理团队 API 或上传图片。首次未缓存的内容仍需联网。

模板卡片的缩略图通过本地记录生成 srcDoc，点击插入复用记录。选中内容块后点击「应用样式」，`template-style.ts` 保留语义内容并替换卡片外观，可撤销；无文字区域的模板明确提示不能应用。占位文字转换为空编辑槽，只在编辑器用 CSS 显示提示；画布粘贴插入纯文字，继承模板样式。顶栏分为信息与操作两行，窄桌面操作栏横向滚动；块操作按钮至少 32×32。

运行 `pnpm --filter @kiumi/web test:e2e` 检查 Word、缓存离线读取/更新、无网络渲染、布局、样式移植、占位与粘贴。没有新增依赖；原有 `test:import` 命令继续可用。详细边界见 [本地优先说明](../../../docs/LOCAL_FIRST.md)。

## 视觉系统与块工具栏

`BlockToolbar.tsx` 使用 portal 跟随选中内容，支持固定、两排操作和按可用高度滚动的下拉面板。`lib/block-edit.ts` 从源 HTML 执行文本/样式/图片操作，通过 store commit 保留撤销；原生块 DOM 编辑后转为保留 ID 的 HTML 块。`ArticleSettings.tsx` 管理封面、摘要、作者、标签；公众号草稿默认采用头部封面。

`Modal.tsx` 统一导入、团队、公众号和预览的 portal、焦点循环、Escape 与焦点恢复；具体业务保留 busy 关闭约束。界面 tokens 在 `styles.css`，正文不继承界面主题。规范见 [DESIGN.md](../DESIGN.md)，功能和平台限制见 [编辑工作台](../../../docs/EDITOR_DESIGN.md)。运行 `pnpm --filter @kiumi/web test:editor` 验证新增交互；全量仍用 `test:e2e`。没有新增运行时依赖或构建环境变量。

界面大面积表面统一为米白/素白，画布无彩色渐变。磨砂共享 `--surface-glass`、`--glass-filter`、`--glass-highlight`，彩色只作局部交互点缀；浮层白色透明度 72%、模糊 28px，低饱和滤镜避免底层内容染色。无新增依赖或部署变量；`pnpm --filter @kiumi/web verify:ui` 串联类型检查、编辑回归和生产构建。
