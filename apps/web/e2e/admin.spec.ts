import { expect, test, type Page } from '@playwright/test';

/** The admin panel against a stubbed API: everything below is GUI only. */

const catalog = {
  source: 'https://catalog.example/api.json', fetchedAt: '2026-11-03T08:00:00.000Z', error: null,
  providers: [
    { id: 'acme', name: 'Acme AI', doc: 'https://acme.example/docs', baseUrl: 'https://gw.acme.example/v1', npm: '@ai-sdk/openai-compatible', protocol: 'openai-chat', modelCount: 2 },
    { id: 'claudeish', name: 'Claudeish', doc: null, baseUrl: null, npm: '@ai-sdk/anthropic', protocol: 'anthropic-messages', modelCount: 1 },
    { id: 'opencode-go', name: 'OpenCode Go', doc: 'https://docs.example/go', baseUrl: 'https://og.example/inference/go/openai/v1', npm: '@ai-sdk/openai-compatible', protocol: 'openai-chat', modelCount: 2 },
  ],
};
const models = [
  { id: 'acme-large', name: 'Acme Large', protocol: null, baseUrl: null, status: null, updated: '2026-10-01', released: '2026-09-01', context: 128000, output: 8000, costIn: 1, costOut: 2, reasoning: true, images: true },
  { id: 'acme-mini', name: 'Acme Mini', protocol: null, baseUrl: null, status: 'deprecated', updated: '2025-01-01', released: null, context: 32000, output: 4000, costIn: 0.1, costOut: 0.2, reasoning: false, images: false },
];
const goModels = [
  { id: 'kimi-x', name: 'Kimi X', protocol: null, baseUrl: 'https://og.example/inference/go/openai/v1', status: null, updated: '2026-10-20', released: null, context: 256000, output: 32000, costIn: null, costOut: null, reasoning: true, images: false },
  { id: 'minimax-y', name: 'MiniMax Y', protocol: 'anthropic-messages', baseUrl: 'https://og.example/inference/go/anthropic/v1', status: null, updated: '2026-10-21', released: null, context: 200000, output: 16000, costIn: null, costOut: null, reasoning: true, images: false },
];
const empty = { version: 0, source: 'none', envFallback: null, catalogUrl: '', defaultCatalogUrl: 'https://catalog.example/api.json', purposes: { annotate: { targets: [], maxTokens: 1500, timeoutMs: 30000 }, plan: { targets: [], maxTokens: 4000, timeoutMs: 60000 } }, providers: [], targets: [] };

async function stub(page: Page, admin = true) {
  const saved: any[] = [];
  await page.route('**/api/me', route => route.fulfill({ json: { ok: true, data: { user: { sub: 'root', name: 'Root' }, loginEnabled: true, admin } } }));
  await page.route('**/api/admin/catalog?**', route => route.fulfill({ json: { ok: true, data: catalog } }));
  await page.route('**/api/admin/catalog', route => route.fulfill({ json: { ok: true, data: catalog } }));
  await page.route('**/api/admin/catalog/models?**', route => {
    const provider = new URL(route.request().url()).searchParams.get('provider');
    return route.fulfill({ json: { ok: true, data: { provider, models: provider === 'opencode-go' ? goModels : models } } });
  });
  await page.route('**/api/admin/llm/test', route => route.fulfill({ json: { ok: true, data: { ok: true, ms: 820, sample: '可用' } } }));
  await page.route('**/api/admin/llm', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      saved.push(body);
      const providers = body.providers.map((p: any) => ({ ...p, keys: p.keys.map((k: any, i: number) => ({ id: `k${i}`, label: k.label, enabled: k.enabled, last4: k.apiKey.slice(-4), masked: `••••${k.apiKey.slice(-4)}`, addedAt: '2026-11-03T08:00:00.000Z' })) }));
      const targets = providers.flatMap((p: any) => p.models.map((m: any) => ({ id: `${p.id}/${m.id}`, providerId: p.id, modelId: m.id, order: m.order, callable: m.enabled && p.keys.length > 0 })));
      return route.fulfill({ json: { ok: true, data: { ...empty, version: 1, source: 'panel', updatedBy: 'root', providers, targets, purposes: body.purposes, catalogUrl: body.catalogUrl } } });
    }
    return route.fulfill({ json: { ok: true, data: empty } });
  });
  return saved;
}

test('non-admins are told how admins are set', async ({ page }) => {
  await stub(page, false);
  await page.goto('/admin.html');
  await expect(page.getByText('KIUMI_ADMIN_SUBS')).toBeVisible();
});

test('a provider is added from the catalog, given a key and models, and saved as one document', async ({ page }) => {
  const saved = await stub(page);
  await page.goto('/admin.html');
  await expect(page.getByText('还没有可用的模型')).toBeVisible();

  await page.getByRole('button', { name: '添加提供商' }).click();
  await page.screenshot({ path: 'test-results/admin-add.png' });
  await page.getByRole('combobox').fill('acme');
  await page.keyboard.press('Enter');
  await expect(page.locator('.provider-card')).toHaveCount(1);
  await expect(page.getByPlaceholder(/https/).first()).toHaveValue('https://gw.acme.example/v1');

  await page.getByPlaceholder('粘贴 API Key').fill('sk-test-12345678');
  await page.getByRole('button', { name: '添加 Key' }).click();
  await expect(page.getByText('••••5678')).toBeVisible();

  await page.getByRole('button', { name: '从目录选模型' }).click();
  await expect(page.getByText('上下文 128K')).toBeVisible();
  await page.locator('.model-picker').screenshot({ path: 'test-results/admin-picker.png' });
  await page.getByText('Acme Large').click();
  await page.getByPlaceholder('或手动输入模型 id').fill('acme-custom');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '测试' }).first().click();
  await expect(page.getByText(/可用 · 0\.8 秒/)).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-provider.png', fullPage: true });

  await page.getByRole('button', { name: '调用顺序与用途' }).click();
  await page.getByRole('button', { name: '下移' }).first().click();
  await page.locator('.purpose-targets').last().getByText('acme/acme-large').click();
  await page.screenshot({ path: 'test-results/admin-order.png', fullPage: true });

  await expect(page.getByText('有未保存的更改')).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/已保存（版本 1）/)).toBeVisible();
  const body = saved[0];
  expect(body.version).toBe(0);
  expect(body.providers[0]).toMatchObject({ id: 'acme', catalogId: 'acme', protocol: 'openai-chat', baseUrl: 'https://gw.acme.example/v1' });
  expect(body.providers[0].keys).toEqual([{ label: '', enabled: true, apiKey: 'sk-test-12345678' }]);
  expect(body.providers[0].models.map((m: any) => [m.id, m.order])).toEqual([['acme-large', 1], ['acme-custom', 0]]);
  expect(body.purposes.plan.targets).toEqual(['acme/acme-large']);
  await expect(page.getByText('已同步 · 版本 1 · root')).toBeVisible();
});

test('cards are dragged by their grip: others make way, the order changes locally and is saved once', async ({ page }) => {
  const saved = await stub(page);
  const writes: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET' && r.url().includes('/api/admin/llm') && !r.url().endsWith('/test')) writes.push(r.method()); });
  await page.goto('/admin.html');
  await page.getByRole('button', { name: '添加提供商' }).click();
  await page.getByRole('combobox').fill('acme');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder('粘贴 API Key').fill('sk-test-12345678');
  await page.getByRole('button', { name: '添加 Key' }).click();
  for (const id of ['m-one', 'm-two', 'm-three']) {
    await page.getByPlaceholder('或手动输入模型 id').fill(id);
    await page.getByRole('button', { name: '添加', exact: true }).click();
  }
  await page.getByRole('button', { name: '调用顺序与用途' }).click();
  const rows = page.locator('.admin-card').first().locator('.sortable > li');
  await expect(rows).toHaveCount(3);

  // Lift the first card and carry it past the other two.
  const grip = rows.nth(0).locator('[data-sort-handle]');
  const box = (await grip.boundingBox())!;
  const step = (await rows.nth(1).boundingBox())!.y - (await rows.nth(0).boundingBox())!.y;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + step * 2.1, { steps: 12 });
  await expect(rows.nth(0)).toHaveAttribute('data-lifted', 'true');
  await expect(rows.nth(1)).toHaveAttribute('data-shifted', 'true');
  await expect(rows.nth(2)).toHaveAttribute('data-shifted', 'true');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/admin-drag.png' });
  await page.mouse.up();
  await expect(rows.locator('code')).toHaveText(['acme/m-two', 'acme/m-three', 'acme/m-one']);
  await expect(rows.nth(2)).toHaveAttribute('data-landing', 'true');

  // Keyboard: the focused grip moves its card up, focus stays with it.
  await rows.nth(2).locator('[data-sort-handle]').focus();
  await page.keyboard.press('ArrowUp');
  await expect(rows.locator('code')).toHaveText(['acme/m-two', 'acme/m-one', 'acme/m-three']);
  await expect(rows.nth(1).locator('[data-sort-handle]')).toBeFocused();

  // Nothing was written while editing; one save carries the whole draft.
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/已保存（版本 1）/)).toBeVisible();
  expect(writes).toEqual(['PUT']);
  expect(saved[0].providers[0].models.map((m: any) => [m.id, m.order])).toEqual([['m-one', 1], ['m-two', 0], ['m-three', 2]]);
});

test('OpenCode Go: the session header is preset and catalog models keep their own protocol and address', async ({ page }) => {
  const saved = await stub(page);
  const tests: any[] = [];
  await page.route('**/api/admin/llm/test', async route => { tests.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, data: { ok: true, ms: 500, sample: '可用' } } }); });
  await page.goto('/admin.html');
  await page.getByRole('button', { name: '添加提供商' }).click();
  await page.getByRole('combobox').fill('opencode');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/OpenCode Go 要求每次会话带稳定的 x-opencode-session/)).toBeVisible();
  await expect(page.getByLabel('会话请求头')).toHaveValue('x-opencode-session');
  await page.getByPlaceholder('粘贴 API Key').fill('sk-og-12345678');
  await page.getByRole('button', { name: '添加 Key' }).click();
  await page.getByRole('button', { name: '从目录选模型' }).click();
  await page.getByText('MiniMax Y').click();
  await page.getByText('Kimi X').click();
  const rows = page.locator('.provider-card .admin-list').last().locator('li');
  await expect(rows.first().getByRole('combobox')).toHaveText(/Anthropic Messages/);
  await expect(rows.first().locator('.admin-model-url input')).toHaveValue('https://og.example/inference/go/anthropic/v1');
  await expect(rows.nth(1).getByRole('combobox')).toHaveText(/跟随提供商协议/);
  await rows.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/admin-opencode.png' });
  await rows.first().getByRole('button', { name: '测试' }).click();
  await expect(rows.first().getByText(/可用/)).toBeVisible();
  expect(tests[0].provider).toMatchObject({ protocol: 'anthropic-messages', baseUrl: 'https://og.example/inference/go/anthropic/v1', sessionHeader: 'x-opencode-session' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/已保存（版本 1）/)).toBeVisible();
  expect(saved[0].providers[0]).toMatchObject({ catalogId: 'opencode-go', sessionHeader: 'x-opencode-session', protocol: 'openai-chat', baseUrl: 'https://og.example/inference/go/openai/v1' });
  expect(saved[0].providers[0].models.map((m: any) => [m.id, m.protocol ?? null, m.baseUrl ?? null])).toEqual([['minimax-y', 'anthropic-messages', 'https://og.example/inference/go/anthropic/v1'], ['kimi-x', null, null]]);
});
