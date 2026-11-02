import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULES, blankLineHtml, formatArticleTitle, imageCss, lintBlocks, normalizeRules, paragraphCss } from '../src/index.ts';

test('long titles keep the lead and drop commas', () => {
  assert.equal(formatArticleTitle('直播助力非遗传承，文创赋能乡村振兴'), '直播助力非遗传承 文创赋能乡村振兴');
  assert.equal(formatArticleTitle('乡村振兴：学生走进工匠小镇开展直播推广'), '乡村振兴');
  assert.equal(formatArticleTitle('春季研学｜走进罗洞'), '春季研学');
});

test('rules are validated, not trusted', () => {
  const r = normalizeRules({ bodySize: 999, textColor: 'red', imageWidth: 80, firstLineIndent: false } as never);
  assert.equal(r.bodySize, DEFAULT_RULES.bodySize);
  assert.equal(r.textColor, '#000000');
  assert.equal(r.imageWidth, 80);
  assert.equal(r.firstLineIndent, false);
});

test('lint flags grey text, image width, fake indent and missing blank lines', () => {
  const body = `<p style="${paragraphCss('body')}">正文内容</p>`;
  const grey = '<p style="color:#3f3f3f;font-size:14px">灰色</p>';
  const fake = '<p style="color:#000000">　　假缩进的一段话</p>';
  const photo = `<p><img src="https://x/a.jpg" style="${imageCss()}"></p>`;
  const narrow = '<p><img src="https://x/b.jpg" style="width:60%"></p>';
  const issues = lintBlocks([{ html: body, strict: true }, { html: photo, strict: true }, { html: narrow, strict: true }, { html: grey, strict: true }, { html: fake, strict: true }]);
  const rules = new Set(issues.map(i => i.rule));
  for (const r of ['text-color', 'image-width', 'fake-indent', 'blank-around-image']) assert.ok(rules.has(r), r);
  const clean = lintBlocks([{ html: body, strict: true }, { html: blankLineHtml(), strict: true }, { html: photo, strict: true }, { html: blankLineHtml(), strict: true }, { html: body, strict: true }]);
  assert.deepEqual(clean, []);
});
