import { test, expect, type Page } from '@playwright/test';

const ph = (n: number) => '正文' + ' ​'.repeat(n);
const unit = (inner: string) => `<div style="position:static"><section>${inner}</section></div>`;
const text = (n: number, style = '') => unit(`<div style="${style}"><p><span>${ph(n)}</span></p></div>`);
const photo = unit('<div><img src="/assets/x/mat/i/fvId/abc_sz-773899.jpg" style="width:100%"></div>');
const decor = unit('<img src="/assets/x/orn_sz_4563.png" style="width:100%">');
const TEMPLATE = `<section>${[text(14, 'font-size:200%'), decor, text(120), photo, text(120), photo, text(90)].join('')}</section>`;

async function harness(page: Page) {
  await page.route('**/harness', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.route('**/api/template?*', route => route.fulfill({ json: { ok: true, data: { atomTplId: 'shop:paper/test', displayName: '测试风格', room: '风格排版', accessibility: 'Free', html: TEMPLATE, matrix: [], hasSvg: false, hasAnimation: false, byteSize: TEMPLATE.length, tplIds: [], assetUrls: [], source: 'test', fetchedAt: '' } } }));
  await page.goto('/harness');
}

/** A submission ZIP built in the page: a Word file with small placeholders and large camera originals. */
const buildBundle = () => (page: Page) => page.evaluate(async () => {
  const { default: JSZip } = await import('/@id/jszip');
  const draw = (seed: number, w: number, h: number) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${seed * 83 % 360},70%,45%)`); grad.addColorStop(1, `hsl(${(seed * 83 + 120) % 360},60%,70%)`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { g.fillStyle = `hsl(${(seed * 41 + i * 57) % 360},80%,${30 + (i * 11 + seed * 7) % 50}%)`; g.beginPath(); g.arc(((seed * 97 + i * 131) % 100) / 100 * w, ((seed * 53 + i * 71) % 100) / 100 * h, (0.05 + ((seed + i) % 5) * 0.04) * w, 0, 7); g.fill(); }
    return c;
  };
  const jpeg = (c: HTMLCanvasElement, q: number) => new Promise<Uint8Array>(r => c.toBlob(async b => r(new Uint8Array(await b!.arrayBuffer())), 'image/jpeg', q));
  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  docx.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + [1, 2].map(n => `<Relationship Id="i${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${n}.jpg"/>`).join('') + '</Relationships>');
  // Document order: seed 3 first, seed 1 second. Camera originals are named in capture order 1, 2, 3.
  const order = [3, 1];
  for (let i = 0; i < 2; i++) docx.file(`word/media/image${i + 1}.jpg`, await jpeg(draw(order[i], 200, 150), 0.4));
  const img = (rid: string) => `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="图"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const p = (t: string, pr = '') => `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}<w:r>${/<w:jc/.test(pr) ? '<w:rPr><w:b/><w:sz w:val="36"/></w:rPr>' : ''}<w:t>${t}</w:t></w:r></w:p>`;
  docx.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${[
    p('直播助力非遗传承，文创赋能乡村振兴', '<w:jc w:val="center"/>'),
    p('——走进广州从化罗洞工匠小镇', '<w:jc w:val="right"/>'),
    p('第一段正文内容，足够长以免被识别为标题，并且以句号结尾，用于测试结构识别。'),
    img('i1'), img('i2'),
    p('第二段正文内容，同样足够长，并且以句号结尾。文：梁锦淇 图：李文筑'),
  ].join('')}</w:body></w:document>`);
  const zip = new JSZip();
  zip.file('稿件/稿件.docx', await docx.generateAsync({ type: 'uint8array' }));
  for (const n of [1, 2, 3]) zip.file(`稿件/微信图片_2026102909092${n}_150${n}.jpg`, await jpeg(draw(n, 1600, 1200), 0.9));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  (await import('/src/api.ts')).setWorkspace('u', 't');
  const mod = await import('/src/lib/word-import/index.ts');
  const preview = await mod.prepareFile(new File([bytes], '稿件.zip'));
  const rows = preview.matching!.rows.map((r: any) => ({ original: r.originalId, level: r.level }));
  const ty = await import('/src/lib/typeset-import.ts');
  const rules = (await import('/src/store.ts')).useStore.getState().typesetRules;
  const styled = await ty.typesetPreview(preview, 'shop:paper/test', rules);
  return { rows, assets: preview.assets.length, outline: ty.recognize(preview).outline, html: styled.preview.items[0].block.html as string, report: styled.report, issues: preview.issues.map((i: any) => i.location) };
});

test('ZIP with Word and camera originals: placeholders are matched, ordered and poured into the style', async ({ page }) => {
  await harness(page);
  const r = await buildBundle()(page);
  expect(r.rows.map((x: any) => x.original)).toEqual(['稿件/微信图片_20261029090923_1503.jpg', '稿件/微信图片_20261029090921_1501.jpg']);
  expect(r.rows.every((x: any) => x.level !== 'none')).toBe(true);
  // Both originals used, the third goes to the gallery.
  expect(r.assets).toBe(3);
  expect(r.issues.some((l: string) => l.includes('未使用'))).toBe(true);
  expect(r.outline[0]).toContain('直播助力非遗传承');
  expect(r.report.images).toBe(2);
  expect(r.html).toContain('直播助力非遗传承 文创赋能乡村振兴');
  expect(r.html.match(/<img src="blob:/g)?.length).toBe(2);
  expect(r.html.indexOf('第一段正文')).toBeLessThan(r.html.indexOf('blob:'));
  expect(r.html).toContain('文：梁锦淇 图：李文筑');
  expect(r.html).not.toContain('​');
});

test('a model plan that fails review goes back with its problems, and the rule plan is used when it keeps failing', async ({ page }) => {
  await harness(page);
  const prompts: string[] = [];
  let answer: unknown = { entries: [{ u: 2, t: { 0: ['p0'] } }] }; // drops most of the manuscript
  await page.route('**/api/manuscript/plan', async route => { prompts.push(route.request().postDataJSON().prompt); await route.fulfill({ json: { ok: true, data: answer } }); });
  const run = () => page.evaluate(async template => {
    (await import('/src/api.ts')).setWorkspace('u', 't');
    const core = await import('/@id/@kiumi/core');
    const ty = await import('/src/lib/typeset-import.ts');
    const T = (i: number, t: string) => ({ i, kind: 'text', text: t, html: `<p>${t}</p>` });
    const facts = [T(0, '直播助力非遗传承'), T(1, '第一段正文内容，足够长以免被识别为标题，并以句号结尾。'), { i: 2, kind: 'image', text: '', html: '', images: ['a'] }, T(3, '第二段正文内容，同样足够长，并以句号结尾。')];
    const m = core.assembleManuscript(facts as never, core.classifyFacts(facts as never));
    return ty.requestPlan(template, m, core.DEFAULT_RULES);
  }, TEMPLATE);

  const failed = await run();
  expect(failed.status).toBe('rejected');
  expect(failed.plan).toBeNull();
  expect(prompts.length).toBe(3); // first answer + two review rounds
  expect(prompts[0]).not.toContain('程序复核');
  expect(prompts[1]).toContain('程序复核发现以下问题，必须全部改正');
  expect(prompts[1]).toContain('没有排进方案');
  expect(prompts[1].startsWith(prompts[0])).toBe(true);

  // A corrected answer in the review round is accepted.
  prompts.length = 0;
  let calls = 0;
  await page.unroute('**/api/manuscript/plan');
  await page.route('**/api/manuscript/plan', async route => {
    prompts.push(route.request().postDataJSON().prompt);
    const good = { entries: [{ u: 0, t: { 0: ['T'] } }, { u: 2, t: { 0: ['p0'] } }, { u: 3, img: ['f0'] }, { u: 4, t: { 0: ['p1'] } }] };
    await route.fulfill({ json: { ok: true, data: calls++ ? good : answer } });
  });
  const fixed = await run();
  expect(fixed.status).toBe('model');
  expect(prompts.length).toBe(2);
});

test('local submission ZIP sample is recognized end to end', async ({ page }) => {
  const sample = process.env.KIUMI_ZIP_SAMPLE;
  test.skip(!sample, 'Set KIUMI_ZIP_SAMPLE (and optionally KIUMI_STYLE_RECORD) to try a real submission ZIP.');
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(sample!);
  const record = process.env.KIUMI_STYLE_RECORD ? JSON.parse(await readFile(process.env.KIUMI_STYLE_RECORD, 'utf8')) : null;
  await page.route('**/harness', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  if (record) await page.route('**/api/template?*', route => route.fulfill({ json: { ok: true, data: record } }));
  await page.route('**/sample.zip', route => route.fulfill({ contentType: 'application/zip', body: buffer }));
  await page.goto('/harness');
  const result = await page.evaluate(async ({ id }) => {
    (await import('/src/api.ts')).setWorkspace('u', 't');
    const mod = await import('/src/lib/word-import/index.ts');
    const preview = await mod.prepareFile(new File([await (await fetch('/sample.zip')).arrayBuffer()], 'sample.zip'));
    const ty = await import('/src/lib/typeset-import.ts');
    const rules = (await import('/src/store.ts')).useStore.getState().typesetRules;
    const rec = ty.recognize(preview);
    const out: any = { outline: rec.outline, matches: preview.matching?.rows.map((r: any) => [r.originalId, r.level, Math.round(r.confidence * 100)]), issues: preview.issues };
    out.parts = rec.manuscript.sections.flatMap((x: any) => x.parts.map((p: any) => p.type + ':' + (p.images ? p.images.map((u: string) => u.slice(-8)).join(',') : (p.text || '').slice(0, 10))));
    out.repl = Object.entries(preview.replacements ?? {}).map(([a, b]: any) => a.slice(-8) + '>' + b.slice(-8));
    if (id) { const styled = await ty.typesetPreview(preview, id, rules); out.report = styled.report; out.html = styled.preview.items[0].block.html; }
    return out;
  }, { id: record?.atomTplId });
  console.log(JSON.stringify({ parts: result.parts, repl: result.repl, outline: result.outline, matches: result.matches, issues: result.issues, report: result.report }, null, 1));
  if (result.html && process.env.KIUMI_STYLE_OUT) (await import('node:fs')).writeFileSync(process.env.KIUMI_STYLE_OUT, result.html);
});

test('an Agent edit arrives over the live socket and lands on the canvas, undoable and revision-aware', async ({ page }) => {
  const doc = (rev: number, html: string) => ({ version: 1, id: 'live-doc', title: '直播稿', blocks: [{ kind: 'library', id: 'b1', tplId: 'imported:段落', matrix: [], html }], meta: { createdAt: '', updatedAt: '', rev } });
  let remote = doc(1, '<p>原来的正文</p>');
  const saves: any[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: any = [];
    if (path === '/api/me') data = { user: { sub: 'user', name: '测试用户' }, loginEnabled: true };
    if (path === '/api/teams') data = [{ id: 'team', name: '测试团队', role: 'owner' }];
    if (path === '/api/documents/live-doc') {
      if (request.method() === 'PATCH') { saves.push(request.postDataJSON()); data = { ...remote, meta: { ...remote.meta, rev: remote.meta.rev + 1 } }; remote = data; }
      else data = remote;
    }
    if (path === '/api/render') { const body = request.postDataJSON().document; data = { html: body.blocks.map((b: any) => b.html).join(''), bytes: 0, warnings: [], issues: [] }; }
    await route.fulfill({ json: { ok: true, data } });
  });
  let server: import('@playwright/test').WebSocketRoute | undefined;
  await page.routeWebSocket(/\/api\/documents\/live-doc\/live/, ws => { server = ws; });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '测试团队', exact: true })).toBeVisible();
  await page.evaluate(async doc => (await import('/src/store.ts')).useStore.getState().loadDoc(doc as never), remote);
  await expect.poll(() => server).toBeTruthy();
  await expect(page.locator('[data-block-content]')).toContainText('原来的正文');

  // The Agent inserts a block: it shows up without any reload.
  remote = doc(2, '<p>原来的正文</p>');
  server!.send(JSON.stringify({ type: 'changed', rev: 2, by: 'agent', ops: [{ op: 'insert', blocks: [{ kind: 'library', id: 'b2', tplId: 'imported:段落', matrix: [], html: '<p>Agent 新增的段落</p>' }] }] }));
  await expect(page.locator('[data-block-content]').last()).toContainText('Agent 新增的段落');
  expect(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.meta.rev)).toBe(2);

  // One undo takes the Agent's change back out.
  await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().undo());
  await expect(page.locator('[data-block-content]')).toHaveCount(1);
  await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().redo());

  // Our own echo is ignored; a gap in revisions refetches the whole document.
  server!.send(JSON.stringify({ type: 'changed', rev: 3, by: 'user', from: await page.evaluate(async () => (await import('/src/api.ts')).clientId) }));
  remote = { ...doc(5, '<p>服务器上的最新版</p>') };
  server!.send(JSON.stringify({ type: 'changed', rev: 5, by: 'agent', ops: [{ op: 'title', title: 'x' }] }));
  await expect(page.locator('[data-block-content]')).toHaveCount(1);
  await expect(page.locator('[data-block-content]')).toContainText('服务器上的最新版');

  // Saving carries the revision it was based on.
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  expect(saves[0].baseRev).toBe(5);
});
