# 桌面工作台

React + Zustand。左上角团队入口提供创建/加入/切换团队、成员邀请、文稿打开与删除。文稿和图库随团队共享，收藏、最近使用及块剪贴板只保存在本机。

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

模板卡片的缩略图通过本地记录生成 srcDoc，点击插入复用记录。选中内容块后点击「应用样式」，`template-style.ts` 保留语义内容并替换卡片外观，可撤销；无文字区域的模板明确提示不能应用。占位文字转换为空编辑槽，只在编辑器用 CSS 显示提示；画布粘贴插入纯文字，继承模板样式。块操作按钮至少 32×32。

运行 `pnpm --filter @kiumi/web test:e2e` 检查 Word、缓存离线读取/更新、无网络渲染、布局、样式移植、占位与粘贴。没有新增依赖；原有 `test:import` 命令继续可用。详细边界见 [本地优先说明](../../../docs/LOCAL_FIRST.md)。

## 界面结构

`App.tsx` 组织键盘、导出与预览；`Topbar.tsx`、`ResourceIsland.tsx`、`Canvas.tsx`（含 `Dock.tsx`、`BlockToolbar.tsx`）、`Inspector.tsx`、`Toast.tsx` 各管一块。`ui.tsx` 提供共用的 `useDroplet`/`Droplet` 选中液滴、`Segmented`、`IconButton`、`SheetHeader`、`PopMenu`；`Modal.tsx` 统一 portal、焦点循环、Escape 与焦点恢复。

界面 tokens 在 `tokens.css`，组件规则在 `styles.css`（已替换旧的层叠覆盖，不再用 Tailwind 工具类写组件，只保留其基础样式与 `sr-only`）。玻璃的模糊放在伪元素上，这样溢出的菜单能采样到页面，而不是父级。文章正文不继承界面主题。规范见 [DESIGN.md](../DESIGN.md)，功能和平台限制见 [编辑工作台](../../../docs/EDITOR_DESIGN.md)。

`BlockToolbar.tsx` 跟随选中内容，`lib/block-edit.ts` 从源 HTML 执行文本/样式/图片操作，通过 store commit 保留撤销；原生块 DOM 编辑后转为保留 ID 的 HTML 块。`ArticleSettings.tsx` 管理封面、摘要、作者、标签、主题色与发布前检查；公众号草稿默认采用此封面。收藏和剪贴板用 `lib/block-label.ts` 展示正文摘要而非内部 ID；`lib/template-name.ts` 过滤目录编号，`lib/glint.ts` 让主按钮高光跟随指针。删除文稿和解除绑定用 `ConfirmAction.tsx` 就地确认。

## 视觉检查复现

启动前端后运行 `pnpm --filter @kiumi/web capture:ui`（默认连接 `http://127.0.0.1:5184`，可用 `KIUMI_UI_URL` 指定本机开发地址）。脚本在独立浏览器上下文拦截 API，使用明确标为示例的内容，生成三种桌面宽度、资源面板、检查器标签、全部工具菜单和弹窗及异常、登录、低高度、减少动效和模拟玻璃回退共 37 张截图至忽略目录 `.impeccable/review/current/`；不会请求真实团队数据或同步公众号。需使用开发服务器，因为脚本读取开发态 store 来准备固定内容；热更新过 `store.ts` 后要重启开发服务器，否则脚本取到的是另一份 store 实例。

`verify:ui` 串联类型检查、全量浏览器回归和生产构建。无新增依赖、生产环境变量或部署步骤；真实公众号发布未执行。
