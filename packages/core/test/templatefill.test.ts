import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeTemplate, assembleManuscript, classifyFacts, fillTemplate, type SourceFact } from '../src/index.ts';

const ph = (n: number) => '正文' + ' ​'.repeat(n);
const unit = (inner: string) => `<div style="position:static"><section>${inner}</section></div>`;
const text = (n: number, style = '') => unit(`<div style="${style}"><p><span>${ph(n)}</span></p></div>`);
const photo = unit('<div><img src="/assets/x/y/mat/i/fvId/abc_sz-773899.jpg" style="width:100%"></div>');
const decor = unit('<img src="/assets/x/orn_sz_4563.png" style="width:100%">');
const template = `<section>${[
  text(14, 'font-size:200%'), decor, text(120), photo, text(120), text(90), photo,
].join('')}</section>`;

const T = (i: number, t: string): SourceFact => ({ i, kind: 'text', text: t, html: `<p>${t}</p>` });
const I = (i: number, ref: string): SourceFact => ({ i, kind: 'image', text: '', html: '', images: [ref] });
const facts = [
  T(0, '直播助力非遗传承，文创赋能'),
  T(1, '第一段正文内容，足够长以免被识别为标题，并以句号结尾。'),
  I(2, 'a'), I(3, 'b'),
  T(4, '第二段正文内容，同样足够长，并以句号结尾。文：甲 图：乙'),
];

test('template schema separates title, text, photo and decor units', () => {
  const s = analyzeTemplate(template);
  assert.deepEqual(s.units.map(u => u.kind), ['title', 'decor', 'text', 'photo', 'text', 'text', 'photo']);
  assert.equal(s.summary.photo, 2);
});

test('manuscript fills title, text and photos in order and clones/removes units', () => {
  const m = assembleManuscript(facts, classifyFacts(facts));
  const { html, report } = fillTemplate(template, m, { resolveImage: r => `/uploads/${r}.jpg` });
  assert.ok(!html.includes('\u200b'), 'no placeholder padding left');
  assert.match(html, /直播助力非遗传承 文创赋能/);
  assert.ok(html.indexOf('/uploads/a.jpg') < html.indexOf('/uploads/b.jpg'));
  assert.ok(html.indexOf('第一段正文') < html.indexOf('/uploads/a.jpg'));
  assert.ok(html.indexOf('/uploads/b.jpg') < html.indexOf('第二段正文'));
  assert.match(html, /文：甲 图：乙/);
  assert.equal(report.images, 2);
  assert.match(html, /font-size:14px/);
  assert.match(html, /color:#000000/);
});

test('missing photo slots are reported instead of silently dropped', () => {
  const noPhoto = `<section>${[text(14, 'font-size:200%'), text(120)].join('')}</section>`;
  const m = assembleManuscript(facts, classifyFacts(facts));
  const { report } = fillTemplate(noPhoto, m, { resolveImage: r => r });
  assert.ok(report.warnings.some(w => w.includes('图片位')));
});
