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
const menu = (page: import('@playwright/test').Page, label: string) => toolbar(page).locator(`summary[aria-label="${label}"]`);
const content = (page: import('@playwright/test').Page) => page.locator('[data-editor-block="one"] [data-block-content]');

test('toolbar formats nested text, persists source and supports undo', async ({ page }) => {
  await openEditor(page);
  await toolbar(page).getByLabel('字号', { exact: true }).fill('24');
  await expect(content(page).locator('p').first()).toHaveCSS('font-size', '24px');
  await expect(content(page).locator('a')).toHaveCSS('font-size', '24px');
  await menu(page, '对齐').click();
  await toolbar(page).getByRole('button', { name: '居中对齐' }).click();
  await expect(content(page).locator('p').first()).toHaveCSS('text-align', 'center');
  await menu(page, '间距').click();
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
  await menu(page, '更多').click();
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
  await menu(page, '更多').click();
  await toolbar(page).getByRole('button', { name: '前插空行' }).click();
  await expect(page.locator('[data-editor-block]')).toHaveCount(3);
  await page.getByLabel('文章标题', { exact: true }).fill('完整标题');
  await page.getByRole('button', { name: '图文', exact: true }).click();
  await page.getByLabel('分享摘要', { exact: true }).fill('摘要已保存');
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
  await menu(page, '更多').click();
  await toolbar(page).getByLabel('查找文字').focus();
  await page.keyboard.press('Escape');
  await expect(toolbar(page).locator('details[open]')).toHaveCount(0);
  await expect(toolbar(page)).toBeVisible();
  await menu(page, '更多').click();
  await toolbar(page).getByRole('button', { name: '左右翻转' }).focus();
  await page.keyboard.press('Escape');
  await expect(toolbar(page).locator('details[open]')).toHaveCount(0);
  await toolbar(page).getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('button', { name: '图文收藏', exact: true }).click();
  await page.getByRole('button', { name: '使用', exact: true }).click();
  await expect(page.locator('[data-editor-block]')).toHaveCount(3);
  await expect(page.locator('[data-editor-block]').last()).toContainText('第二段文字');
});

test('1280px toolbar stays on one row and clears selected text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await openEditor(page);
  await expect.poll(async () => toolbar(page).evaluate(el => {
    const rows = [...el.querySelectorAll('.toolbar-row')];
    return rows.every(row => { const tops = [...row.children].map(child => Math.round(child.getBoundingClientRect().top)); return Math.max(...tops) - Math.min(...tops) < 8; });
  })).toBe(true);
  const bar = await toolbar(page).boundingBox(), block = await page.locator('[data-editor-block="one"]').boundingBox(), title = await page.getByLabel('文章标题', { exact: true }).boundingBox();
  expect(bar!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
  expect(bar!.y >= block!.y + block!.height || bar!.y + bar!.height <= block!.y).toBe(true);
});

test('toolbar menus stay below the top capsules so every row is reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 680 }); await openEditor(page);
  await menu(page, '更多').click();
  const popover = await toolbar(page).locator('details[open] .tool-popover').boundingBox();
  const capsules = await page.locator('.capsule-delivery').boundingBox();
  expect(popover!.y).toBeGreaterThanOrEqual(capsules!.y + capsules!.height);
  expect(popover!.y + popover!.height).toBeLessThanOrEqual(680);
});

test('toolbar row fits inside its glass at 1280 and every template type stays reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await openEditor(page);
  await expect.poll(() => toolbar(page).evaluate(el => { const bar = el.getBoundingClientRect(); return [...el.querySelector('.toolbar-row')!.children].every(item => item.getBoundingClientRect().right <= bar.right - 4); })).toBe(true);
  await page.evaluate(async () => (await import('/src/store.ts')).useStore.setState({ rooms: ['甲类', '乙类', '丙类', '丁类', '戊类', '己类', '庚类', '辛类'].map((name, i) => ({ tag: `modern:${i}`, name, order: i, house: 'paper', floor: 'comp', count: 1 })) }));
  const panel = await page.locator('.template-browser').boundingBox();
  for (const chip of await page.getByRole('group', { name: '模板类型' }).getByRole('button').all()) {
    const box = await chip.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
  }
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

test('outline uses content labels and keyboard selection with bounded move actions', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  const outline = page.getByLabel('文稿内容列表');
  const second = outline.getByRole('button', { name: /独立内容保持不变/ });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  const actions = page.getByLabel('选中内容操作');
  await expect(actions.getByRole('button', { name: '下移', exact: true })).toBeDisabled();
  await actions.getByRole('button', { name: '上移', exact: true }).click();
  await expect(outline.getByRole('button').first()).toContainText('独立内容保持不变');
  await expect(actions.getByRole('button', { name: '上移', exact: true })).toBeDisabled();
  await actions.getByRole('button', { name: '复制到剪贴板', exact: true }).click();
  await page.getByRole('button', { name: '剪贴板', exact: true }).click();
  await expect(page.getByRole('button', { name: '粘贴', exact: true })).toBeVisible();
});

test('team and publishing forms expose labels, cover selection and narrow-height layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 680 });
  await page.route('**/assets/cover.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#e8effb"/><rect x="20" y="20" width="80" height="80" rx="12" fill="#f4dfe9"/></svg>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/api/me' ? { user: { sub: 'editor', name: '编辑' }, loginEnabled: true }
      : path === '/api/teams' ? [{ id: 'team', name: '内容编辑部', role: 'owner' }]
      : path === '/api/accounts' ? [{ id: 'account', name: '周末编辑室', appId: 'demo' }]
      : path === '/api/uploads' ? [{ id: 'cover', name: '春日封面', url: '/assets/cover.png', bytes: 12 }]
      : [];
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '内容编辑部', exact: true }).click();
  const teamDialog = page.getByRole('dialog', { name: '团队工作空间' });
  await expect(teamDialog.getByRole('combobox', { name: '当前团队' })).toHaveAttribute('data-value', 'team');
  await expect(teamDialog.getByLabel('新团队名称')).toBeVisible();
  await expect(teamDialog.getByLabel('团队邀请码')).toBeVisible();
  await teamDialog.screenshot({ path: 'test-results/team-dialog.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '公众号草稿', exact: true }).click();
  const draft = page.getByRole('dialog', { name: '公众号草稿' });
  const cover = draft.getByRole('button', { name: '选择封面：春日封面' });
  await cover.click();
  await expect(cover).toHaveAttribute('aria-pressed', 'true');
  await draft.getByRole('button', { name: '管理团队公众号' }).click();
  await expect(draft.getByLabel('公众号名称', { exact: true })).toBeVisible();
  await expect(draft.getByLabel('AppID', { exact: true })).toBeVisible();
  await expect(draft.getByLabel('AppSecret', { exact: true })).toHaveAttribute('type', 'password');
  const box = await draft.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(20);
  expect(box!.y + box!.height).toBeLessThanOrEqual(660);
  await draft.screenshot({ path: 'test-results/wechat-dialog.png' });
  await draft.getByLabel('AppSecret', { exact: true }).focus();
  await draft.screenshot({ path: 'test-results/wechat-account-fields.png' });
  await draft.getByRole('button', { name: '解除绑定', exact: true }).click();
  await expect(draft.getByRole('button', { name: '确认解除绑定' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(draft).toBeVisible();
  await expect(draft.getByRole('button', { name: '确认解除绑定' })).toHaveCount(0);
  await expect(draft.getByRole('button', { name: '解除绑定', exact: true })).toBeFocused();
});

test('canvas context menu stays visible and Escape dismisses it', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-editor-block="one"]').evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1278, clientY: 718 })));
  const menu = page.locator('.canvas-context-menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('dialog Escape still works after an asynchronous control loses focus', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: '导入内容', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入内容' });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入内容', exact: true })).toBeFocused();
});

test('glass listbox supports keyboard, mouse and Escape without closing its dialog', async ({ page }) => {
  await openEditor(page);
  const font = toolbar(page).getByRole('combobox', { name: '字体' });
  await font.click();
  await page.getByRole('option', { name: '宋体' }).click();
  await expect(content(page).locator('p').first()).toHaveCSS('font-family', 'serif');
  await font.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: '字体' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(font).toBeFocused();
});

test('canvas and preview read article HTML in one context', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => { const { useStore } = await import('/src/store.ts'); const state = useStore.getState(); state.updateHtml(0, '<h2>标题</h2><p>段落</p>'); });
  const heading = page.locator('[data-editor-block="one"] h2');
  await expect(heading).toHaveCSS('font-weight', '700');
  await expect(heading).toHaveCSS('font-size', '24px');
  await expect(page.locator('[data-editor-block="one"] p')).toHaveCSS('margin-top', '0px');
  await expect(page.locator('[data-editor-block="one"] p')).toHaveCSS('box-sizing', 'border-box');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const preview = page.frameLocator('iframe[title="preview"]').getByText('段落');
  await expect(preview).toHaveCSS('box-sizing', 'border-box');
  await expect(preview).toHaveCSS('margin-top', '0px');
});

test('publishing checklist never reports ready on a blank document', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { ok: true, data: [] } }));
  await page.goto('/');
  const check = page.getByLabel('发布前检查');
  await expect(check).toContainText('发布前还有');
  await expect(check).toContainText('添加正文内容');
});

test.describe('inline text editing', () => {
  const load = (page: import('@playwright/test').Page, html: string) => page.evaluate(async html => {
    const { useStore } = await import('/src/store.ts');
    const state = useStore.getState();
    state.loadDoc({ ...state.doc, blocks: [{ kind: 'library', id: 'edit', tplId: 'fixture', matrix: [], html }] });
  }, html);
  const editable = (page: import('@playwright/test').Page) => page.locator('[data-editor-block="edit"] [data-block-content]');
  const caret = (page: import('@playwright/test').Page) => page.locator('.inline-caret');
  /** Reads in the page: the bar remounts on every move, so a held element handle can go stale. */
  const bar = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const rect = document.querySelector('.inline-caret')!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  /** Puts the selection at `offset` in the first text node, as a click would. */
  const placeAt = async (page: import('@playwright/test').Page, offset: number) => {
    await page.waitForSelector('[contenteditable="true"]');
    await page.evaluate(offset => {
      const node = document.querySelector('[contenteditable="true"]')!.firstChild!;
      document.getSelection()!.collapse(node, offset);
    }, offset);
  };
  /** Screen distance from the caret bar's centre to where the browser says the caret is. */
  const drift = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const bar = document.querySelector('.inline-caret')?.getBoundingClientRect();
    const rect = document.getSelection()!.getRangeAt(0).getClientRects()[0];
    if (!bar || !rect) return { x: Infinity, y: Infinity };
    return { x: Math.abs((bar.left + bar.right) / 2 - rect.left), y: Math.abs((bar.top + bar.bottom) / 2 - (rect.top + rect.bottom) / 2) };
  });
  const expectAligned = async (page: import('@playwright/test').Page) => {
    await expect.poll(async () => { const { x, y } = await drift(page); return Math.max(x, y); }).toBeLessThan(1.5);
  };

  test('editable text shows the text cursor and only while editing', async ({ page }) => {
    await openEditor(page);
    await load(page, '<section><p>第一段 <a href="https://example.com"><strong>链接</strong></a></p><p>第二段</p></section>');
    const first = editable(page).locator('p').first();
    await expect(first).toHaveCSS('cursor', 'pointer');
    await first.dblclick();
    await expect(first).toHaveCSS('cursor', 'text');
    await expect(first.locator('strong')).toHaveCSS('cursor', 'text');
    await expect(editable(page).locator('p').nth(1)).toHaveCSS('cursor', 'pointer');
    await page.locator('.paper-title').click();
    await expect(first).toHaveCSS('cursor', 'pointer');
  });

  test('the drawn caret is thick, follows typing across lines and leaves nothing in the document', async ({ page }) => {
    await openEditor(page);
    const text = '班会围绕学生日常安全、学校发展动态及期末诚信应考三大板块展开，旨在增强学生安全意识，凝聚校园共识，营造公平、诚信的期末考试氛围。';
    await load(page, `<section style="background:#fb7158;padding:12px"><p style="color:#fff;text-align:center;font-size:20px">${text}</p></section>`);
    const paragraph = editable(page).locator('p');
    await paragraph.dblclick();
    await placeAt(page, 30);
    await expect(caret(page)).toBeVisible();
    await expect(paragraph).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    const size = await bar(page);
    expect(size.width).toBeGreaterThanOrEqual(2);
    expect(size.height).toBeGreaterThanOrEqual(20);
    await expectAligned(page);
    await page.locator('[data-editor-block="edit"]').screenshot({ path: test.info().outputPath('caret.png') });

    await page.keyboard.type('新增');
    await expectAligned(page);
    // Forward delete recentres the line without moving the selection.
    await page.keyboard.press('Delete');
    await expectAligned(page);
    for (const key of ['End', 'Home', 'ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
      await expect(caret(page)).toBeVisible();
    }

    // A real range shows the selection, not a caret.
    await page.keyboard.press('Shift+ArrowRight');
    await expect(caret(page)).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(caret(page)).toBeVisible();

    await page.locator('.paper-title').click();
    await expect(caret(page)).toHaveCount(0);
    await expect(paragraph).not.toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    const saved = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks[0]);
    expect(JSON.stringify(saved)).toContain('新增');
    expect(JSON.stringify(saved)).not.toMatch(/caret|contenteditable/i);
  });

  test('a block edited while it slides in ends with the caret on the text', async ({ page }) => {
    await openEditor(page);
    await page.addStyleTag({ content: '.editor-block { animation-duration: 900ms !important; }' });
    await load(page, '<section><p style="font-size:18px">刚插入就开始编辑</p></section>');
    // dispatchEvent skips Playwright's wait for the element to stop moving.
    await editable(page).locator('p').dispatchEvent('dblclick', { bubbles: true });
    await placeAt(page, 3);
    await expect(caret(page)).toBeVisible();
    // Right after measuring the caret matches by definition; only the end state proves anything.
    await page.evaluate(() => Promise.all(document.querySelector('.editor-block')!.getAnimations().map(animation => animation.finished)));
    await expectAligned(page);
  });

  test('at a soft wrap the caret stays on the line it was moved to', async ({ page }) => {
    await openEditor(page);
    await load(page, '<section><p style="font-size:20px">班会围绕学生日常安全、学校发展动态及期末诚信应考三大板块展开，旨在增强学生安全意识，凝聚校园共识。</p></section>');
    const paragraph = editable(page).locator('p');
    await paragraph.dblclick();
    await placeAt(page, 3);
    const onFirstLine = await bar(page);
    await page.keyboard.press('End');
    await expect.poll(async () => (await bar(page)).x).toBeGreaterThan(onFirstLine.x + 100);
    expect((await bar(page)).y).toBeLessThan(onFirstLine.y + 8);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await expect.poll(async () => (await bar(page)).x).toBeLessThan(onFirstLine.x);
    expect((await bar(page)).y).toBeGreaterThan(onFirstLine.y + 20);
  });

  test('the caret stays on the text under canvas zoom and while an IME composes', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openEditor(page);
    await load(page, '<section><p style="font-size:18px">缩放之后光标也要贴着文字</p></section>');
    await editable(page).locator('p').dblclick();
    await placeAt(page, 4);
    await expectAligned(page);
    for (const zoom of [50, 150]) {
      await page.evaluate(async zoom => (await import('/src/store.ts')).useStore.getState().setZoom(zoom), zoom);
      await expectAligned(page);
      expect((await bar(page)).width).toBeCloseTo(2, 0);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ceshi', selectionStart: 5, selectionEnd: 5 });
    await expect(caret(page)).toBeVisible();
    await expectAligned(page);
    await cdp.send('Input.insertText', { text: '测试' });
    await expect(editable(page).locator('p')).toContainText('测试');
    await expectAligned(page);
  });

  test('empty lines, empty slots and vertical text still get a caret', async ({ page }) => {
    await openEditor(page);
    await load(page, '<section><p style="text-align:center" data-kiumi-placeholder="写点什么"></p><p style="writing-mode:vertical-rl;height:140px;font-size:18px">竖排文字竖排文字</p><p>一行</p></section>');
    const empty = editable(page).locator('p').first();
    await empty.click();
    await empty.dblclick();
    await expect(caret(page)).toBeVisible();
    const slot = (await empty.boundingBox())!, inSlot = await bar(page);
    expect(Math.abs(inSlot.x - (slot.x + slot.width / 2))).toBeLessThan(4);
    expect(inSlot.y).toBeGreaterThanOrEqual(slot.y - 8);
    await page.locator('.paper-title').click();

    const vertical = editable(page).locator('p').nth(1);
    await vertical.dblclick();
    await placeAt(page, 3);
    await expect.poll(async () => { const { width, height } = await bar(page); return width > height; }).toBe(true);
    await page.locator('.paper-title').click();

    const line = editable(page).locator('p').nth(2);
    await line.dblclick();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(caret(page)).toBeVisible();
    const first = (await line.boundingBox())!;
    await expect.poll(async () => (await bar(page)).y).toBeGreaterThan(first.y + 10);
  });

  test('rotated blocks fall back to the native caret', async ({ page }) => {
    await openEditor(page);
    await load(page, '<section style="transform:rotate(20deg)"><p>旋转的文字</p></section>');
    const paragraph = editable(page).locator('p');
    await paragraph.dblclick({ force: true });
    await expect(paragraph).toHaveAttribute('contenteditable', 'true');
    await expect(caret(page)).toHaveCount(0);
    await expect(paragraph).not.toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
  });
});

test.describe('formatting part of a block', () => {
  const TEXT = '会计学2502班在辅导员主持下展开';
  const load = (page: import('@playwright/test').Page, html: string) => page.evaluate(async html => {
    const { useStore } = await import('/src/store.ts');
    const state = useStore.getState();
    state.loadDoc({ ...state.doc, blocks: [{ kind: 'library', id: 'edit', tplId: 'fixture', matrix: [], html }, { kind: 'native', id: 'other', node: { kind: 'text', text: '别的内容' } }] });
  }, html);
  const body = (page: import('@playwright/test').Page) => page.locator('[data-editor-block="edit"] [data-block-content]');
  /** Double-clicks into the paragraph, then selects `words` as a drag would. */
  const selectWords = async (page: import('@playwright/test').Page, words: string) => {
    await body(page).locator('p').first().dblclick();
    await page.waitForSelector('[contenteditable="true"]');
    await page.evaluate(words => {
      const root = document.querySelector('[contenteditable="true"]')!, texts: Text[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
      const whole = texts.map(text => text.data).join(''), from = whole.indexOf(words), to = from + words.length, range = document.createRange();
      let seen = 0;
      for (const text of texts) {
        if (seen <= from && from < seen + text.length) range.setStart(text, from - seen);
        if (seen < to && to <= seen + text.length) range.setEnd(text, to - seen);
        seen += text.length;
      }
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, words);
    await expect(toolbar(page).getByRole('button', { name: '加粗', exact: true })).toBeVisible();
    await page.waitForTimeout(30);
  };
  const leave = (page: import('@playwright/test').Page) => page.locator('[data-editor-block="other"]').click();
  /** Weight of the word as rendered: 700 only where it was asked for. */
  const weightOf = (page: import('@playwright/test').Page, words: string) => body(page).evaluate((root, words) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue!.includes(words)) return getComputedStyle(node.parentElement!).fontWeight;
    return 'missing';
  }, words);
  const saved = (page: import('@playwright/test').Page) => page.evaluate(async () => {
    const block = (await import('/src/store.ts')).useStore.getState().doc.blocks[0]!;
    return block.kind === 'library' ? block.html! : '';
  });
  const bold = (page: import('@playwright/test').Page) => toolbar(page).getByRole('button', { name: '加粗', exact: true });

  test('selected words take the format, the rest of the block does not, and it reaches the document', async ({ page }) => {
    await openEditor(page);
    await load(page, `<section><p style="color:#fff;background:#fb7158">${TEXT}</p></section>`);
    await selectWords(page, '2502班');
    await bold(page).click();
    await expect.poll(() => weightOf(page, '2502班')).toBe('700');
    expect(await weightOf(page, '会计学')).not.toBe('700');
    await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
    // Still editing, still selected, so formats stack.
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe('2502班');
    await expect(body(page).locator('[contenteditable="true"]')).toHaveCount(1);
    await toolbar(page).getByRole('button', { name: '斜体', exact: true }).click();
    await expect(body(page).locator('span', { hasText: '2502班' })).toHaveCSS('font-style', 'italic');

    await leave(page);
    await expect(body(page).locator('[contenteditable]')).toHaveCount(0);
    const html = await saved(page);
    expect(html).toMatch(/<span style="[^"]*font-weight: bold[^"]*">2502班<\/span>/);
    expect(html).toContain('会计学');
    expect(renderDocument(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc)).html).toContain('2502班</span>');
  });

  test('a mouse drag over part of a template paragraph bolds only what was dragged', async ({ page }) => {
    await openEditor(page);
    await load(page, `<section style="background:#fb7158;padding:12px"><p style="color:#fff;text-align:center;font-size:20px">2025年12月，华南农业大学珠江学院经济管理学院${TEXT}，旨在增强学生安全意识，凝聚校园共识。</p></section>`);
    const paragraph = body(page).locator('p').first();
    await paragraph.dblclick();
    await page.waitForSelector('[contenteditable="true"]');
    const box = (await paragraph.boundingBox())!;
    const y = box.y + 44;
    await page.mouse.move(box.x + 120, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, y, { steps: 6 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => document.getSelection()!.toString());
    expect(dragged.length).toBeGreaterThan(1);
    await page.screenshot({ path: test.info().outputPath('selected.png') });
    await bold(page).click();
    await expect.poll(() => weightOf(page, dragged)).toBe('700');
    expect(await weightOf(page, '华南农业大学')).toBe('400');
    await toolbar(page).getByLabel('字号', { exact: true }).fill('26');
    await expect(body(page).locator('span', { hasText: dragged })).toHaveCSS('font-size', '26px');
    await page.locator('[data-editor-block="edit"]').screenshot({ path: test.info().outputPath('field-focused.png') });
    await leave(page);
    await page.locator('[data-editor-block="edit"]').screenshot({ path: test.info().outputPath('done.png') });
    expect(await saved(page)).toContain(`>${dragged}</span>`);
  });

  test('selecting only blank space counts as no selection and loses nothing', async ({ page }) => {
    await openEditor(page);
    await load(page, '<section><p>前面   后面</p></section>');
    await selectWords(page, '   ');
    await bold(page).click();
    await expect(body(page).locator('[contenteditable]')).toHaveCount(0);
    await expect.poll(() => weightOf(page, '前面')).toBe('700');
  });

  test('without selected words the whole block is formatted, with or without an open edit', async ({ page }) => {
    await openEditor(page);
    await load(page, `<section><p>${TEXT}</p></section>`);
    await body(page).locator('p').click();
    await bold(page).click();
    await expect.poll(() => weightOf(page, '2502班')).toBe('700');
    expect(await weightOf(page, '会计学')).toBe('700');
    await bold(page).click();
    await expect.poll(() => weightOf(page, '2502班')).toBe('400');

    // A bare caret selects nothing: same as the whole block, and what was typed survives.
    await body(page).locator('p').dblclick();
    await page.waitForSelector('[contenteditable="true"]');
    await page.keyboard.press('End');
    await page.keyboard.type('新增');
    await bold(page).click();
    await expect(body(page).locator('p')).toHaveText(`${TEXT}新增`);
    await expect.poll(() => weightOf(page, '新增')).toBe('700');
    await expect(body(page).locator('[contenteditable]')).toHaveCount(0);
  });

  test('toolbar fields and menus keep the selection while they hold the focus', async ({ page }) => {
    await openEditor(page);
    await load(page, `<section><p>${TEXT}</p></section>`);
    await selectWords(page, '2502班');
    const size = toolbar(page).getByLabel('字号', { exact: true });
    await size.fill('24');
    const words = body(page).locator('span', { hasText: '2502班' });
    await expect(words).toHaveCSS('font-size', '24px');
    await expect(size).toBeFocused();
    await size.fill('30');
    await expect(words).toHaveCSS('font-size', '30px');

    await menu(page, '文字颜色').click();
    await toolbar(page).locator('input[aria-label="文字颜色"]').fill('#ff0000');
    await expect(words).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(toolbar(page).locator('.color-dot')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await menu(page, '文字颜色').click();

    await toolbar(page).getByRole('combobox', { name: '字体' }).click();
    await page.getByRole('option', { name: '宋体' }).click();
    await expect(words).toHaveCSS('font-family', 'serif');

    await menu(page, '间距').click();
    await toolbar(page).getByLabel('字间距', { exact: true }).fill('3');
    await expect(words).toHaveCSS('letter-spacing', '3px');
    await menu(page, '间距').click();

    await menu(page, '文字格式').click();
    await toolbar(page).getByRole('button', { name: '下划线' }).click();
    await expect(words).toHaveCSS('text-decoration-line', 'underline');
    await toolbar(page).getByLabel('文字底色', { exact: true }).fill('#00ff00');
    await expect(words).toHaveCSS('background-color', 'rgb(0, 255, 0)');
    await toolbar(page).getByRole('button', { name: '清除文字格式' }).click();
    await expect(words).toHaveCSS('font-size', '16px');
    await expect(words).toHaveCSS('text-decoration-line', 'none');
    await size.fill('20');
    await expect(words).toHaveCSS('font-size', '20px');

    // Clicking away from a field has no block blur to end the edit.
    await leave(page);
    await expect(body(page).locator('[contenteditable]')).toHaveCount(0);
    expect(await saved(page)).toMatch(/font-size: 20px[^>]*>2502班/);
    expect(await weightOf(page, '会计学')).toBe('400');
  });

  test('a selection across formatted runs styles each run and only the selected part', async ({ page }) => {
    await openEditor(page);
    await load(page, '<section><p>前面<strong>粗的文字</strong>中间<span style="color:#ff0000">红的文字</span>后面</p></section>');
    await selectWords(page, '文字中间红的');
    await toolbar(page).getByLabel('字号', { exact: true }).fill('24');
    const sized = await body(page).evaluate(root => [...root.querySelectorAll<HTMLElement>('span')].filter(span => span.style.fontSize === '24px').map(span => span.textContent));
    expect(sized.join('')).toBe('文字中间红的');
    await expect(body(page).locator('p')).toHaveText('前面粗的文字中间红的文字后面');
    await expect(body(page).locator('strong')).toHaveText('粗的文字');
  });

  test('Ctrl+Z takes back one format at a time and the whole edit undoes as one step', async ({ page }) => {
    await openEditor(page);
    await load(page, `<section><p>${TEXT}</p></section>`);
    const before = await saved(page);
    await selectWords(page, '2502班');
    await bold(page).click();
    await toolbar(page).getByRole('button', { name: '斜体', exact: true }).click();
    await page.keyboard.press('Control+z');
    await expect(body(page).locator('p')).toHaveText(TEXT);
    await expect(body(page).locator('span', { hasText: '2502班' })).not.toHaveCSS('font-style', 'italic');
    expect(await weightOf(page, '2502班')).toBe('700');
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe('2502班');
    await page.keyboard.press('Control+z');
    await expect.poll(() => weightOf(page, '2502班')).toBe('400');
    await bold(page).click();
    await expect.poll(() => weightOf(page, '2502班')).toBe('700');
    await leave(page);
    await expect.poll(() => saved(page)).toContain('font-weight: bold');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(() => saved(page)).toBe(before);
  });

  test('paragraph settings and block actions end the edit and keep it', async ({ page }) => {
    await openEditor(page);
    await load(page, `<section><p>${TEXT}</p><p>第二段</p></section>`);
    await selectWords(page, '2502班');
    await bold(page).click();
    await expect.poll(() => weightOf(page, '2502班')).toBe('700');
    await menu(page, '对齐').click();
    await toolbar(page).getByRole('button', { name: '居中对齐' }).click();
    await expect(body(page).locator('p').first()).toHaveCSS('text-align', 'center');
    await expect(body(page).locator('p').nth(1)).toHaveCSS('text-align', 'center');
    await expect(body(page).locator('[contenteditable]')).toHaveCount(0);
    expect(await saved(page)).toMatch(/font-weight: bold[^>]*>2502班/);
    expect(await weightOf(page, '会计学')).not.toBe('700');
  });

  test('plain native text can be formatted in part too', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      const { useStore } = await import('/src/store.ts');
      const state = useStore.getState();
      state.loadDoc({ ...state.doc, blocks: [{ kind: 'native', id: 'edit', node: { kind: 'text', text: '原生正文里的几个字' } }, { kind: 'native', id: 'other', node: { kind: 'text', text: '别的内容' } }] });
    });
    await selectWords(page, '几个字');
    await bold(page).click();
    await leave(page);
    await expect.poll(() => weightOf(page, '几个字')).toBe('700');
    expect(await weightOf(page, '原生正文里的')).not.toBe('700');
  });
});
