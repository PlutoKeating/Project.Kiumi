import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { renderDocument, validateHtml } from '../../../packages/core/src/index.ts';

async function wordFile() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>');
  zip.file('word/media/image.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>中文标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>第一段中文 😀</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="图片"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="img"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>表格单元格</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>最后一段</w:t></w:r></w:p>
  </w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Word file produces ordered headings, paragraphs, images and intact tables without binary text', async ({ page }) => {
  await page.route('**/harness', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('/harness');
  const buffer = await wordFile();
  const result = await page.evaluate(async (bytes) => {
    const mod = await import('/src/lib/word-import/index.ts');
    (await import('/src/api.ts')).setWorkspace('test-user', 'test-team');
    const file = new File([new Uint8Array(bytes)], '推文.docx');
    const preview = await mod.prepareFile(file);
    return preview.items.map((item: any) => item.block.html);
  }, [...buffer]);
  expect(result).toHaveLength(5);
  expect(result[0]).toContain('<h2');
  expect(result[0]).toContain('中文标题');
  expect(result[1]).toContain('第一段中文 😀');
  expect(result[2]).toContain('blob:');
  expect(result[3]).toContain('<table');
  expect(result[3]).toContain('表格单元格');
  expect(result[3]).toContain('colspan="2"');
  expect(result[3]).toContain('rowspan="2"');
  expect(result[4]).toContain('<strong');
  expect(result.join('')).not.toContain('[Content_Types]');
  expect(result.join('')).not.toContain('�');
});

async function harness(page: import('@playwright/test').Page) {
  await page.route('**/harness', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('/harness');
}

test('Office paste preserves lists, merged tables, emphasis, heading choice and missing image locations', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const mod = await import('/src/lib/word-import/index.ts');
    (await import('/src/api.ts')).setWorkspace('user', 'team');
    const preview = await mod.prepareText(`<style>p.Title{font-size:24pt;font-weight:bold}</style><div>
      <p class="Title">疑似标题</p><p style="mso-outline-level:3">三级标题</p>
      <p style="mso-list:l0 level1 lfo1">1. 第一条</p><p style="mso-list:l0 level2 lfo1">1.1 子项</p>
      <table><tr><td colspan="2">合并单元格</td></tr><tr><td>A</td><td>B</td></tr></table>
      <p><span style="font-weight:bold;font-style:italic">重点</span><img src="file:///missing.png"></p>
      <script>window.bad=true</script><p onclick="alert(1)">结尾</p></div>`, 'html');
    const candidate = preview.items[0].candidate;
    preview.items[0] = mod.setHeading(preview.items[0], 2);
    return { items: preview.items.map((i: any) => i.block.html), issues: preview.issues, candidate };
  });
  expect(result.items).toHaveLength(6);
  expect(result.candidate).toBe(true);
  expect(result.items[0]).toContain('<h2');
  expect(result.items[1]).toContain('<h3');
  expect(result.items[2]).toMatch(/<ul.*<li.*1\. 第一条.*<ul.*1\.1 子项/s);
  expect(result.items[3]).toContain('colspan="2"');
  expect(result.items[4]).toContain('<strong');
  expect(result.items[4]).toContain('图片待补充');
  expect(result.items.join('')).not.toMatch(/<script|onclick|file:\/\/|font-size:24pt/);
  expect(result.issues.some((i: any) => i.location.includes('图片'))).toBe(true);
});

test('rejects old Word, damaged DOCX, binary masquerading as text and unauthenticated images', async ({ page }) => {
  await harness(page);
  const errors = await page.evaluate(async () => {
    const { prepareFile, prepareText } = await import('/src/lib/word-import/index.ts');
    const errors: string[] = [];
    for (const file of [new File(['bad'], 'test.doc'), new File(['bad'], 'test.docx'), new File(['PK\x03\x04\x00'], 'bad.txt')]) {
      try { await prepareFile(file); errors.push('unexpected success'); } catch (e) { errors.push((e as Error).message); }
    }
    try { await prepareText('<p>正文<img src="file:///tmp/image.png"></p>', 'html'); } catch (e) { errors.push((e as Error).message); }
    return errors;
  });
  expect(errors).toHaveLength(4);
  expect(errors[0]).toContain('另存为 .docx');
  expect(errors[1]).toContain('未损坏');
  expect(errors[2]).toContain('二进制');
  expect(errors[3]).toContain('登录');
});

test('ZIP imports only images and enforces decompressed 80 MB total', async ({ page }) => {
  test.setTimeout(60000);
  await harness(page);
  const zip = new JSZip();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  zip.file('图片/测试.png', png); zip.file('readme.txt', '说明'); zip.file('损坏.png', png.subarray(0, 8));
  const result = await page.evaluate(async bytes => {
    (await import('/src/api.ts')).setWorkspace('user', 'team');
    const { prepareFile } = await import('/src/lib/word-import/index.ts');
    const p = await prepareFile(new File([new Uint8Array(bytes)], '图片.zip'));
    return { gallery: p.galleryOnly, items: p.items.length, assets: p.assets.map((a: any) => a.file.name), issues: p.issues };
  }, [...await zip.generateAsync({ type: 'nodebuffer' })]);
  expect(result.gallery).toBe(true); expect(result.items).toBe(0); expect(result.assets).toEqual(['测试.png']); expect(result.issues).toHaveLength(2); expect(JSON.stringify(result.issues)).toContain('无法解码');
  const big = new JSZip();
  // Compressible bytes exercise expanded-size accounting without a huge test fixture.
  for (let i = 0; i < 9; i++) { const bytes = Buffer.alloc(10 * 1024 * 1024); png.copy(bytes); big.file(`${i}.png`, bytes); }
  const error = await page.evaluate(async bytes => {
    try { await (await import('/src/lib/word-import/index.ts')).prepareFile(new File([new Uint8Array(bytes)], '大图.zip')); return 'unexpected success'; }
    catch (e) { return (e as Error).message; }
  }, [...await big.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })]);
  expect(error).toContain('80 MB');
});

test('numbered headings, list restart, footnotes and complex content have explicit results', async ({ page }) => {
  await harness(page);
  const zip = await JSZip.loadAsync(await wordFile());
  zip.remove('word/media/image.png');
  zip.file('word/numbering.xml', `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num></w:numbering>`);
  const p = (text: string, level: number, num = '1', heading = false) => `<w:p><w:pPr>${heading ? '<w:pStyle w:val="Heading2"/>' : ''}<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${num}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><w:body>
    ${p('编号标题',0,'1',true)}${p('列表子项',1)}${p('下一条',0)}${p('重启编号',0,'2')}
    <w:p><w:del><w:r><w:delText>删除文字</w:delText></w:r></w:del><w:ins><w:r><w:t>保留文字</w:t></w:r></w:ins><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
    <w:p><m:oMath><m:r><m:t>x+1</m:t></m:r></m:oMath></w:p>
    <w:p><w:r><w:drawing><a:graphic><a:graphicData><c:chart/></a:graphicData></a:graphic></w:drawing></w:r></w:p>
    <w:p><w:r><w:drawing><a:graphic><a:graphicData><dgm:relIds/></a:graphicData></a:graphic></w:drawing></w:r></w:p>
    <w:p><w:r><w:instrText> TOC </w:instrText><w:t>目录条目</w:t></w:r></w:p>
  </w:body></w:document>`);
  zip.file('word/footnotes.xml', '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>脚注内容</w:t></w:r></w:p></w:footnote></w:footnotes>');
  zip.file('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>页眉内容</w:t></w:r></w:p></w:hdr>');
  zip.file('word/comments.xml', '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
  const result = await page.evaluate(async bytes => {
    const p = await (await import('/src/lib/word-import/index.ts')).prepareFile(new File([new Uint8Array(bytes)], '复杂稿.docx'));
    return { html: p.items.map((i: any) => i.block.html).join(''), issues: p.issues };
  }, [...await zip.generateAsync({ type: 'nodebuffer' })]);
  expect(result.html).toContain('1. 编号标题');
  expect(result.html).toContain('1.1 列表子项');
  expect(result.html).toContain('2. 下一条');
  expect(result.html).toContain('5. 重启编号');
  expect(result.html).toContain('保留文字'); expect(result.html).not.toContain('删除文字');
  for (const text of ['公式待核对', '图表待补充', 'SmartArt待补充', '页眉内容', '脚注内容']) expect(result.html).toContain(text);
  for (const text of ['修订', '公式', '图表', 'SmartArt', '目录', '页眉', '批注']) expect(JSON.stringify(result.issues)).toContain(text);
});

async function app(page: import('@playwright/test').Page, failUpload: boolean | number = false) {
  const saved = new Map<string, any>();
  let uploads = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: any = [];
    if (path === '/api/me') data = { user: { sub: 'user', name: '测试用户' }, loginEnabled: true };
    if (path === '/api/teams') data = [{ id: 'team', name: '测试团队', role: 'owner' }];
    if (path === '/api/render') { const result = renderDocument(request.postDataJSON().document); data = { ...result, issues: validateHtml(result.html) }; }
    if (path === '/api/assets/upload') {
      uploads++;
      if (failUpload === true || (typeof failUpload === 'number' && uploads <= failUpload)) { await route.fulfill({ status: 500, json: { ok: false, error: { message: '模拟上传失败' } } }); return; }
      data = { url: '/uploads/test-image', sha256: 'test-image', bytes: 68 };
    }
    if (path === '/api/documents' && request.method() === 'POST') { data = { ...request.postDataJSON(), version: 1, id: 'saved-doc' }; saved.set(data.id, data); }
    if (path === '/api/documents/saved-doc') {
      if (request.method() === 'PATCH') saved.set('saved-doc', { ...saved.get('saved-doc'), ...request.postDataJSON() });
      data = saved.get('saved-doc');
    }
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.route('**/uploads/test-image', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '测试团队', exact: true })).toBeVisible();
  return { saved, uploads: () => uploads };
}

test('UI preview does not mutate canvas; confirmed import uploads, edits, saves, restores, exports and undoes as one operation', async ({ page }) => {
  const backend = await app(page);
  await page.getByRole('button', { name: '导入内容', exact: true }).click();
  await page.getByLabel('选择导入文件').setInputFiles({ name: '推文.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordFile() });
  await expect(page.locator('[data-import-block]')).toHaveCount(5);
  expect(backend.uploads()).toBe(0);
  expect(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks.length)).toBe(0);
  const checkbox = page.getByRole('checkbox');
  if (await checkbox.count()) await checkbox.check();
  await page.getByRole('button', { name: '确认导入画布', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.uploads()).toBe(1);
  const imported = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc);
  expect(imported.blocks).toHaveLength(5);
  expect(JSON.stringify(imported)).not.toContain('blob:');
  expect(JSON.stringify(imported)).toContain('/uploads/test-image');
  // One undo removes the whole import; redo restores every block.
  await page.evaluate(async () => { const s = (await import('/src/store.ts')).useStore; s.getState().undo(); });
  expect(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks.length)).toBe(0);
  await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().redo());
  await expect(page.locator('[data-block-content] h2')).toContainText('中文标题');
  await page.locator('[data-block-content] h2').dblclick();
  await page.locator('[data-block-content] h2').fill('编辑后的标题');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => JSON.stringify(backend.saved.get('saved-doc'))).toContain('编辑后的标题');
  await page.reload();
  await expect(page.getByRole('button', { name: '测试团队', exact: true })).toBeVisible();
  await expect(page.locator('[data-block-content] h2')).toContainText('编辑后的标题');
  // Explicitly re-open the API document, not only the browser recovery copy.
  await page.evaluate(async () => { const api = await import('/src/api.ts'); (await import('/src/store.ts')).useStore.getState().loadDoc(await api.openDocument('saved-doc')); });
  await expect(page.locator('[data-block-content] h2')).toContainText('编辑后的标题');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
  const exported = await download;
  const stream = await exported.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  const html = Buffer.concat(chunks).toString('utf8');
  expect(html).toContain('编辑后的标题'); expect(html).toContain('<table'); expect(html).not.toContain('blob:');
  // Capture the real clipboard API payload without requiring system clipboard permissions.
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async (items: ClipboardItem[]) => { (window as any).copiedHtml = await (await items[0].getType('text/html')).text(); } }); });
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedHtml)).toContain('编辑后的标题');
});

test('failed upload leaves document unchanged and retry remains available', async ({ page }) => {
  const backend = await app(page, true);
  await page.getByRole('button', { name: '导入内容', exact: true }).click();
  await page.getByLabel('选择导入文件').setInputFiles({ name: '推文.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordFile() });
  await expect(page.locator('[data-import-block]')).toHaveCount(5);
  if (await page.getByRole('checkbox').count()) await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认导入画布', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('模拟上传失败');
  expect(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks.length)).toBe(0);
  await expect(page.getByRole('button', { name: '确认导入画布', exact: true })).toBeEnabled();
  expect(backend.uploads()).toBe(3);
});

test('upload cancellation and team changes cannot commit cross-team image references', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const api = await import('/src/api.ts'), mod = await import('/src/lib/word-import/index.ts');
    api.setWorkspace('user', 'team-a');
    const preview = await mod.prepareText('<p>测试</p>', 'html');
    const scope = api.workspaceKey(); api.setWorkspace('user', 'team-b');
    const errors: string[] = [];
    try { await mod.uploadPreview(preview, scope, () => {}); } catch (e) { errors.push((e as Error).message); }
    const controller = new AbortController(); controller.abort();
    try { await mod.uploadPreview(preview, api.workspaceKey(), () => {}, controller.signal); } catch (e) { errors.push((e as Error).message); }
    return errors;
  });
  expect(result[0]).toContain('切换'); expect(result[1]).toContain('取消');
});

test('insert-after and new-document destinations preserve existing drafts', async ({ page }) => {
  const backend = await app(page);
  await page.evaluate(async () => {
    const store = (await import('/src/store.ts')).useStore;
    store.getState().addNative('text'); store.getState().addNative('text'); store.getState().select(0);
  });
  const originalIds = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks.map((b: any) => b.id));
  async function importText(destination: string, text: string) {
    await page.getByRole('button', { name: '导入内容', exact: true }).click();
    await page.getByLabel('选择导入文件').setInputFiles({ name: '新稿.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('[data-import-block]')).toHaveCount(1);
    await page.getByLabel('导入位置').selectOption(destination);
    await page.getByRole('button', { name: '确认导入画布', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await importText('after', '插入的正文');
  let doc = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc);
  expect(doc.blocks[0].id).toBe(originalIds[0]); expect(doc.blocks[2].id).toBe(originalIds[1]);
  expect(doc.blocks[1].html).toContain('插入的正文');
  await importText('new', '新文稿内容');
  doc = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc);
  expect(doc.title).toBe('新稿'); expect(doc.blocks).toHaveLength(1);
  expect(JSON.stringify(backend.saved.get('saved-doc'))).toContain('插入的正文');
  await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().undo());
  expect(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks.length)).toBe(3);
});

test('generic HTML keeps SVG layout while Office equations and tracked changes are explicit', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const mod = await import('/src/lib/word-import/index.ts');
    const html = await mod.prepareRichHtml('<section style="color:red"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg><p>布局文字</p></section>');
    const blocks = await mod.uploadPreview(html, (await import('/src/api.ts')).workspaceKey(), () => {});
    const office = await mod.prepareText('<p class="MsoNormal"><del>删除</del><ins>插入</ins><math><mi>x</mi></math></p>', 'html');
    return { html: blocks[0].html, office: office.items[0].block.html, issues: office.issues };
  });
  expect(result.html).toContain('<svg'); expect(result.html).toContain('rgb(255, 0, 0)');
  expect(result.office).not.toContain('删除'); expect(result.office).toContain('插入'); expect(result.office).toContain('公式/图形待核对');
  expect(JSON.stringify(result.issues)).toContain('修订');
});

// Optional private sample: never copy a user's source document into the repository.
test('provided Word sample preserves every nonempty source paragraph', async ({ page }) => {
  const path = process.env.KIUMI_WORD_SAMPLE;
  test.skip(!path, 'Set KIUMI_WORD_SAMPLE to validate a local Word document without committing it.');
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(path!);
  const zip = await JSZip.loadAsync(buffer);
  const source = await zip.file('word/document.xml')!.async('string');
  await harness(page);
  const result = await page.evaluate(async ({ bytes, source }) => {
    (await import('/src/api.ts')).setWorkspace('sample-user', 'sample-team');
    const mod = await import('/src/lib/word-import/index.ts');
    const preview = await mod.prepareFile(new File([new Uint8Array(bytes)], 'sample.docx'));
    const xml = new DOMParser().parseFromString(source, 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const expected = [...xml.getElementsByTagNameNS(ns, 'p')].map(p => [...p.getElementsByTagNameNS(ns, 't')].map(t => t.textContent).join('')).filter(t => t.trim());
    const root = document.createElement('div'); root.innerHTML = preview.items.map((i: any) => i.block.html).join('');
    document.body.append(root);
    const compact = (s: string) => s.replace(/\s+/g, '');
    const output = compact(root.textContent || '');
    const missing = expected.filter(t => !output.includes(compact(t)));
    let cursor = 0, outOfOrder = 0;
    for (const paragraph of expected) { const position = output.indexOf(compact(paragraph), cursor); if (position < 0) outOfOrder++; else cursor = position + compact(paragraph).length; }
    return { count: preview.items.length, assets: preview.assets.length, missing: missing.length, outOfOrder, labels: preview.items.map((i: any) => i.label), issues: preview.issues, invalidCharacters: root.textContent?.includes('�') };
  }, { bytes: [...buffer], source });
  expect(result.missing).toBe(0);
  expect(result.outOfOrder).toBe(0);
  expect(result.invalidCharacters).toBe(false);
  expect(result.count).toBeGreaterThan(1);
  console.log('Local Word sample:', JSON.stringify(result));
  if (process.env.KIUMI_WORD_SCREENSHOT) {
    await app(page);
    await page.getByRole('button', { name: '导入内容', exact: true }).click();
    await page.getByLabel('选择导入文件').setInputFiles(path!);
    await expect(page.locator('[data-import-block]')).toHaveCount(result.count);
    const overflow = await page.locator('[data-import-block] > div:last-child').evaluateAll(nodes => nodes.some(n => n.scrollWidth > n.clientWidth + 1));
    expect(overflow).toBe(false);
    await page.screenshot({ path: process.env.KIUMI_WORD_SCREENSHOT, fullPage: true });
  }
});


test('transient upload failure recovers without a second confirmation', async ({ page }) => {
  const backend = await app(page, 1);
  await page.getByRole('button', { name: '导入内容', exact: true }).click();
  await page.getByLabel('选择导入文件').setInputFiles({ name: '推文.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordFile() });
  await expect(page.locator('[data-import-block]')).toHaveCount(5);
  if (await page.getByRole('checkbox').count()) await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认导入画布', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.uploads()).toBe(2);
});

test('canvas renders synchronously without API and accepts internal image addresses only in editor', async ({ page }) => {
  await harness(page);
  await page.route('**/api/**', route => route.abort());
  const result = await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts');
    const s = useStore.getState();
    s.loadDoc({ ...s.doc, blocks: [
      { kind: 'library', id: 'local', tplId: 'imported:段落', matrix: [], html: '<p>立即显示</p><img src="/uploads/img_abc"><img src="relative.png">' },
    ] });
    return { html: useStore.getState().previews.local, issues: useStore.getState().issues };
  });
  expect(result.html).toContain('立即显示');
  expect(result.issues.filter(i => i.rule === 'relative-image')).toHaveLength(1);
  expect(result.issues.find(i => i.rule === 'relative-image')?.message).toContain('relative.png');
});

test('catalog persists across reloads, serves offline and refreshes in background', async ({ page }) => {
  await harness(page);
  let revision = '旧标题';
  let offline = false;
  let failed = 0;
  await page.route('**/api/template?**', async route => {
    if (offline) { failed++; await route.abort(); return; }
    if (revision === '新标题') await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ json: {ok:true,data:{atomTplId:'cache-test',displayName:revision,html:`<h2>${revision}</h2>`,matrix:[]}} });
  });
  const fetchTitle = () => page.evaluate(async () => (await (await import('/src/api.ts')).fetchTemplate('cache-test')).displayName);
  expect(await fetchTitle()).toBe('旧标题');
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('kiumi-catalog-v1')).keys()).length)).toBe(1);
  offline = true;
  await page.reload();
  expect(await fetchTitle()).toBe('旧标题');
  await expect.poll(() => failed).toBe(1);
  offline = false; revision = '新标题';
  await page.reload();
  expect(await fetchTitle()).toBe('旧标题');
  await expect.poll(fetchTitle).toBe('新标题');
});

test('template preview warms insertion; cached insertion and editing do not call render API', async ({ page }) => {
  const backend = await app(page);
  let renders = 0;
  await page.route('**/api/render', route => { renders++; return route.abort(); });
  await page.route('**/api/template?**', route => route.fulfill({json:{ok:true,data:{atomTplId:'local-template',displayName:'缓存标题',matrix:[],html:'<h2>模板本地内容</h2>'}}}));
  await page.evaluate(async () => { (await import('/src/store.ts')).useStore.setState({templates:[{atomTplId:'local-template',displayName:'缓存标题',room:'demo:header',accessibility:'Public',hasSvg:false,hasAnimation:false,byteSize:1}]}); });
  await expect(page.locator('iframe').first()).toHaveAttribute('srcdoc', /模板本地内容/);
  await page.route('**/api/template?**', route => route.abort());
  await page.getByRole('button', {name:'缓存标题'}).click();
  await expect(page.locator('[data-block-content] h2')).toHaveText('模板本地内容');
  expect(renders).toBe(0);
  void backend;
});

test('toolbar keeps account and actions on intentional rows at desktop widths', async ({ page }) => {
  await app(page);
  for (const width of [1280,1440,1920]) {
    await page.setViewportSize({width,height:900});
    const layout = await page.evaluate(() => {
      const header = document.querySelector('header')!;
      const rows = [...header.children].map(node => node.getBoundingClientRect());
      return {height:header.getBoundingClientRect().height, rows:rows.map(r=>({top:r.top,bottom:r.bottom})), overflow:document.documentElement.scrollWidth > innerWidth};
    });
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows[1].top).toBeGreaterThanOrEqual(layout.rows[0].bottom);
    expect(layout.height).toBeLessThan(130);
    expect(layout.overflow).toBe(false);
  }
});

test('upload validation errors do not retry, and cancellation interrupts retry backoff', async ({ page }) => {
  await harness(page);
  let status = 413, requests = 0;
  await page.route('**/api/assets/upload', route => { requests++; return route.fulfill({status,json:{ok:false,error:{message:'请求失败'}}}); });
  const run = (cancel: boolean) => page.evaluate(async cancel => {
    const api = await import('/src/api.ts'), mod = await import('/src/lib/word-import/index.ts');
    api.setWorkspace('user','team');
    const preview = await mod.prepareText('<p>正文</p>','html');
    preview.assets.push({file:new File(['test'],'test.png'),url:'blob:fake'});
    const controller = new AbortController();
    try { await mod.uploadPreview(preview,api.workspaceKey(),text => { if(cancel && text.includes('重试')) controller.abort(); },controller.signal); }
    catch(error) { return (error as Error).message; }
  },cancel);
  expect(await run(false)).toContain('请求失败'); expect(requests).toBe(1);
  status = 503;
  expect(await run(true)).toContain('取消'); expect(requests).toBe(2);
});

test('background catalog synchronization stores templates that were never opened', async ({ page }) => {
  await harness(page);
  await page.route('**/api/catalog/index', route => route.fulfill({json:{ok:true,data:[{atomTplId:'unseen-a',room:'demo:header',displayName:'离线标题'},{atomTplId:'unseen-b',room:'demo:body',displayName:'离线正文'},{atomTplId:'unseen-a',room:'demo:other',displayName:'离线标题'}]}}));
  await page.route('**/api/template?**', route => route.fulfill({json:{ok:true,data:{atomTplId:new URL(route.request().url()).searchParams.get('id'),html:'<p>后台缓存</p>',matrix:[]}}}));
  await page.evaluate(async () => { await (await import('/src/lib/catalog-sync.ts')).syncCatalog(); });
  const paths = await page.evaluate(async () => (await (await caches.open('kiumi-catalog-v1')).keys()).map(r=>r.url));
  expect(paths.some(p=>p.includes('id=unseen-a'))).toBe(true);
  expect(paths.some(p=>p.includes('id=unseen-b'))).toBe(true);
  await page.route('**/api/**', route => route.abort());
  await page.reload();
  const matches = await page.evaluate(async () => (await import('/src/api.ts')).fetchTemplates({room:'demo:header',q:'离线'}));
  expect(matches.map(m=>m.atomTplId)).toEqual(['unseen-a']);
  const other = await page.evaluate(async () => (await import('/src/api.ts')).fetchTemplates({room:'demo:other'}));
  expect(other.map(m=>m.atomTplId)).toEqual(['unseen-a']);
});

test('catalog uses conditional revalidation and retains data on 304', async ({ page }) => {
  await harness(page);
  let conditional = false;
  await page.route('**/api/template?**', async route => {
    if (route.request().headers()['if-none-match'] === '"revision-1"') {
      conditional = true; await route.fulfill({status:304}); return;
    }
    await route.fulfill({headers:{etag:'"revision-1"'},json:{ok:true,data:{displayName:'持久模板'}}});
  });
  const get = () => page.evaluate(async () => (await (await import('/src/api.ts')).fetchTemplate('etag-test')).displayName);
  expect(await get()).toBe('持久模板');
  await page.reload();
  expect(await get()).toBe('持久模板');
  await expect.poll(() => conditional).toBe(true);
  expect(await get()).toBe('持久模板');
});

test('applying a card style preserves paragraphs, images, tables and block identity and can undo', async ({ page }) => {
  await app(page);
  await page.route('**/api/template?**', route => route.fulfill({json:{ok:true,data:{atomTplId:'card-style',displayName:'新卡片',matrix:[],html:'<section style="background:tomato;padding:20px"><p style="color:white;font-size:20px">输入文字输入文字</p><p>输入文字</p></section>'}}}));
  const result = await page.evaluate(async () => {
    const {useStore} = await import('/src/store.ts');
    const original = '<section style="background:blue"><p style="color:black">第一段</p><p>第二段</p><img src="/uploads/img_a"><table><tr><td colspan="2">表格</td></tr></table></section>';
    useStore.getState().loadDoc({...useStore.getState().doc,blocks:[{kind:'library',id:'keep-id',tplId:'old-card',matrix:[],html:original}]});
    useStore.getState().select(0);
    await useStore.getState().applyTemplateStyle('card-style');
    const after = useStore.getState().doc.blocks[0];
    const root = document.createElement('div'); root.innerHTML = after.kind === 'library' ? after.html! : '';
    const content = root.textContent;
    useStore.getState().undo();
    const restored = useStore.getState().doc.blocks[0];
    return {after,content,restored,original};
  });
  expect(result.after.id).toBe('keep-id');
  expect(result.after.html).toContain('background:tomato');
  expect(result.after.html).not.toContain('background:blue');
  expect(result.after.html).toContain('/uploads/img_a');
  expect(result.after.html).toContain('colspan="2"');
  expect(result.content).toContain('第一段第二段');
  expect(result.content).not.toContain('输入文字');
  expect(result.restored.html).toBe(result.original);
});

test('placeholder text is not article content and pasted text inherits card typography', async ({ page }) => {
  await app(page);
  await page.route('**/api/template?**', route => route.fulfill({json:{ok:true,data:{atomTplId:'placeholder-card',displayName:'空白卡片',matrix:[],html:'<section style="background:tomato"><p style="color:white;font-size:20px">输入文字输入文字</p></section>'}}}));
  await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().insertTemplate('placeholder-card'));
  const paragraph = page.locator('[data-block-content] p');
  await expect(paragraph).toHaveText('');
  await paragraph.dblclick();
  await paragraph.evaluate(el => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain','粘贴正文');
    clipboardData.setData('text/html','<span style="color:black;background:white;font-size:40px">粘贴正文</span>');
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
  });
  await expect(paragraph).toHaveText('粘贴正文');
  await expect(paragraph).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(paragraph).toHaveCSS('font-size','20px');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await paragraph.dblclick();
  await expect(paragraph).toHaveText('粘贴正文');
  const html = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().doc.blocks[0]);
  expect(html.html).not.toContain('输入文字');
  expect(html.html).not.toContain('40px');
  for (const selector of ['.block-tool','.structure-tool']) {
    const sizes = await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})).filter(n=>n.w>0));
    expect(sizes.every(s=>s.w>=32 && s.h>=32)).toBe(true);
  }
});
