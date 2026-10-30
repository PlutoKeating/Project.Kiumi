import { renderDocument } from '../../../packages/core/src/index.ts';
import { test, expect } from '@playwright/test';

async function openEditor(page: import('@playwright/test').Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: { ok: true, data: path === '/api/me' ? { user: null, loginEnabled: true } : [] } });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts');
    const state = useStore.getState();
    state.loadDoc({ ...state.doc, title: '编辑回归', blocks: [
      { kind: 'library', id: 'one', tplId: 'fixture', matrix: [], html: '<section><p style="color:#334455">第一段 <a href="https://example.com">链接</a></p><p>第二段文字</p><img src="/assets/test.png" /></section>' },
      { kind: 'native', id: 'two', node: { kind: 'text', text: '独立内容保持不变' } },
    ] });
  });
  await page.locator('[data-editor-block="one"]').click();
}
const toolbar = (page: import('@playwright/test').Page) => page.getByRole('toolbar', { name: '内容块工具栏' });
const content = (page: import('@playwright/test').Page) => page.locator('[data-editor-block="one"] [data-block-content]');

test('toolbar formats nested text, persists source and supports undo', async ({ page }) => {
  await openEditor(page);
  await toolbar(page).getByLabel('字号', { exact: true }).fill('24');
  await expect(content(page).locator('p').first()).toHaveCSS('font-size', '24px');
  await expect(content(page).locator('a')).toHaveCSS('font-size', '24px');
  await toolbar(page).getByText('对齐', { exact: true }).click();
  await toolbar(page).getByRole('button', { name: '居中对齐' }).click();
  await expect(content(page).locator('p').first()).toHaveCSS('text-align', 'center');
  await toolbar(page).getByText('间距', { exact: true }).click();
  await toolbar(page).getByLabel('字间距', { exact: true }).fill('3');
  await expect(content(page).locator('p').first()).toHaveCSS('letter-spacing', '3px');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(content(page).locator('p').first()).not.toHaveCSS('letter-spacing', '3px');
  await expect(page.locator('[data-editor-block="two"]')).toContainText('独立内容保持不变');
  const document = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc);
  const exported = renderDocument(document).html;
  expect(exported).toContain('font-size: 24px');
  expect(exported).not.toContain('contenteditable');
});

test('effects, replacement, link cleanup and image batch are real document edits', async ({ page }) => {
  await openEditor(page);
  await toolbar(page).getByText('更多', { exact: true }).click();
  await toolbar(page).getByLabel('旋转', { exact: true }).fill('20');
  await toolbar(page).getByRole('button', { name: '左右翻转' }).click();
  await toolbar(page).getByLabel('不透明度', { exact: true }).fill('70');
  await expect(content(page).locator('section')).toHaveCSS('opacity', '0.7');
  await toolbar(page).getByLabel('查找文字', { exact: true }).fill('第二段');
  await toolbar(page).getByLabel('替换为', { exact: true }).fill('新的段落');
  await toolbar(page).getByRole('button', { name: '替换选中块文字' }).click();
  await expect(content(page)).toContainText('新的段落文字');
  await toolbar(page).getByRole('button', { name: '清除链接' }).click();
  await expect(content(page).locator('a')).toHaveCount(0);
  await toolbar(page).getByLabel('图片圆角', { exact: true }).fill('12');
  await toolbar(page).getByRole('button', { name: '应用到块内全部图片' }).click();
  await expect(content(page).locator('img')).toHaveCSS('border-radius', '12px');
  const source = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks[0]);
  expect(JSON.stringify(source)).toContain('rotate(20deg) scaleX(-1)');
  expect(JSON.stringify(source)).toContain('/assets/test.png');
});

test('blank insertion and metadata survive local reload; dialogs contain focus', async ({ page }) => {
  await openEditor(page);
  await toolbar(page).getByText('插入空行', { exact: true }).click();
  await toolbar(page).getByRole('button', { name: '前插空行' }).click();
  await expect(page.locator('[data-editor-block]')).toHaveCount(3);
  await page.getByLabel('文章标题', { exact: true }).fill('完整标题');
  await page.getByLabel('分享摘要', { exact: true }).fill('摘要已保存');
  await page.getByText('更多设置', { exact: true }).click();
  await page.getByLabel('作者', { exact: true }).fill('编辑');
  await page.reload();
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue('完整标题');
  await expect(page.getByLabel('分享摘要', { exact: true })).toHaveValue('摘要已保存');
  await page.getByRole('button', { name: '导入内容', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入内容', exact: true })).toBeFocused();
});

for (const width of [1280, 1440, 1920]) test(`toolbar remains within canvas at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await openEditor(page);
  const area = await page.locator('.editor-canvas').boundingBox(), bar = await toolbar(page).boundingBox();
  expect(bar!.x).toBeGreaterThanOrEqual(area!.x);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(area!.x + area!.width);
  await toolbar(page).getByRole('button', { name: '固定工具栏', exact: true }).click();
  await expect(toolbar(page).getByRole('button', { name: '取消固定工具栏' })).toHaveAttribute('aria-pressed', 'true');
});

test('Escape closes focused menus and block favorites keep edited contents', async ({ page }) => {
  await openEditor(page);
  await toolbar(page).getByText('更多', { exact: true }).click();
  await toolbar(page).getByLabel('查找文字').focus();
  await page.keyboard.press('Escape');
  await expect(toolbar(page).locator('details[open]')).toHaveCount(0);
  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).getByText('更多', { exact: true }).click();
  await toolbar(page).getByRole('button', { name: '左右翻转' }).focus();
  await page.keyboard.press('Escape');
  await expect(toolbar(page).locator('details[open]')).toHaveCount(0);
  await toolbar(page).getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('button', { name: '图文收藏', exact: true }).click();
  await page.getByRole('button', { name: '使用', exact: true }).click();
  await expect(page.locator('[data-editor-block]')).toHaveCount(3);
  await expect(page.locator('[data-editor-block]').last()).toContainText('第二段文字');
});

test('1280px toolbar has exactly two rows and clears selected text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await openEditor(page);
  await expect.poll(async () => toolbar(page).evaluate(el => {
    const rows = [...el.querySelectorAll('.toolbar-row')];
    return rows.every(row => { const tops = [...row.children].map(child => Math.round(child.getBoundingClientRect().top)); return Math.max(...tops) - Math.min(...tops) < 8; });
  })).toBe(true);
  const bar = await toolbar(page).boundingBox(), block = await page.locator('[data-editor-block="one"]').boundingBox();
  expect(bar!.y + bar!.height).toBeLessThan(block!.y);
});

test('asset failures offer retry and image cards support keyboard insertion', async ({ page }) => {
  await openEditor(page);
  let fail = true;
  await page.route('**/api/assets?**', route => route.fulfill(fail
    ? { status: 503, json: { ok: false } }
    : { json: { ok: true, data: [{ url: '/assets/sample.png', path: 'sample.png', bytes: 12 }], meta: { total: 1 } } }));
  await page.getByRole('button', { name: '图片素材', exact: true }).click();
  await expect(page.getByText('素材加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('素材库还没有图片', { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  const card = page.getByRole('button', { name: '插入图片：sample.png' });
  await expect(card).toBeVisible();
  await card.focus(); await page.keyboard.press('Space');
  await expect(page.locator('[data-editor-block]')).toHaveCount(3);
});
