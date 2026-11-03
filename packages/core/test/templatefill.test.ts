import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeTemplate, assembleManuscript, autoPlan, classifyFacts, executePlan, fillTemplate, manuscriptPieces, parsePlan, planPrompt, type SourceFact } from '../src/index.ts';

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

test('pictures without a photo slot are typeset beside their text instead of dropped', () => {
  const noPhoto = `<section>${[text(14, 'font-size:200%'), text(120)].join('')}</section>`;
  const m = assembleManuscript(facts, classifyFacts(facts));
  const { html, report } = fillTemplate(noPhoto, m, { resolveImage: r => `/uploads/${r}.jpg` });
  assert.ok(html.includes('/uploads/a.jpg') && html.includes('/uploads/b.jpg'));
  assert.ok(html.indexOf('第一段正文') < html.indexOf('/uploads/a.jpg'));
  assert.ok(html.indexOf('/uploads/b.jpg') < html.indexOf('第二段正文'));
  assert.equal(report.spilled, 2);
  assert.ok(report.warnings.some(w => w.includes('放不下')));
});

test('a template with no body text area still receives every paragraph', () => {
  const onlyPhotos = `<section>${[photo, decor, photo].join('')}</section>`;
  const m = assembleManuscript(facts, classifyFacts(facts));
  const { html } = fillTemplate(onlyPhotos, m, { resolveImage: r => `/uploads/${r}.jpg` });
  for (const needle of ['第一段正文', '第二段正文', '/uploads/a.jpg', '/uploads/b.jpg', '文：甲 图：乙']) assert.ok(html.includes(needle), needle);
});

const label = (n: number) => unit(`<section style="background:#eef;padding:4px"><p style="font-size:20px"><strong>${ph(n)}</strong></p></section>`);
const flipped = unit('<section style="transform: rotateY(180deg)"><div><img src="/assets/x/p_sz-500000.jpg" style="width:100%"></div><section style="transform: rotateY(180deg)"><p>' + ph(80) + '</p></section></section>');

test('nested article skeletons are cut into content groups', () => {
  const nested = `<section>${unit(`<div style="display:flex"><div style="display:inline-block;width:100%">${[label(10), text(120), photo, text(90)].join('')}</div></div>`)}</section>`;
  const s = analyzeTemplate(nested);
  assert.deepEqual(s.units.map(u => u.kind), ['heading', 'text', 'photo', 'text']);
});

test('model plans can repeat units, write section labels and never lose pieces', () => {
  const tpl = `<section>${[text(14, 'font-size:200%'), text(120), label(8), photo].join('')}</section>`;
  const m = assembleManuscript(facts, classifyFacts(facts));
  const pieces = manuscriptPieces(m);
  assert.deepEqual(pieces.map(p => p.id), ['T', 'p0', 'f0', 'f1', 'p1', 'Y']);
  const prompt = planPrompt(analyzeTemplate(tpl), pieces);
  assert.match(prompt, /u2 heading/);
  assert.match(prompt, /p0 正文/);
  const plan = parsePlan('好的：{"entries":[{"u":0,"t":{"0":["T"]}},{"u":1,"t":{"0":["p0"]}},{"u":2,"t":{"0":"活动缘起"}},{"u":3,"img":["f0"]},{"u":3,"img":["f1","nope"]},{"u":1,"t":{"0":["p1","p0"]}}]}');
  assert.ok(plan);
  const { html, report } = executePlan(tpl, m, plan!, { resolveImage: r => `/uploads/${r}.jpg`, planSource: 'model' });
  assert.match(html, /活动缘起/);
  assert.deepEqual(report.generated, ['活动缘起']);
  assert.equal(report.clonedUnits, 2);
  assert.equal(html.split('第一段正文').length - 1, 1, 'a piece used twice is placed once');
  assert.ok(html.includes('文：甲 图：乙'), 'byline left out of the plan is still set');
  assert.ok(html.indexOf('/uploads/b.jpg') < html.indexOf('第二段正文'));
  assert.ok(!html.includes('\u200b'));
});

test('a poor model plan falls back to the rule plan', () => {
  const m = assembleManuscript(facts, classifyFacts(facts));
  const { report } = fillTemplate(template, m, { plan: [{ u: 2, t: { 0: ['p0'] } }], resolveImage: r => r });
  assert.equal(report.plan, 'auto');
  assert.ok(report.warnings[0].includes('改用规则排版'));
  assert.ok(autoPlan(analyzeTemplate(template), manuscriptPieces(m)).length >= 3);
});

test('unused label boxes are removed and flipped cards are set upright', () => {
  const tpl = `<section>${[text(14, 'font-size:200%'), label(8), flipped].join('')}</section>`;
  const m = assembleManuscript(facts, classifyFacts(facts));
  const { html } = fillTemplate(tpl, m, { resolveImage: r => `/uploads/${r}.jpg` });
  assert.ok(!html.includes('background:#eef'), 'label without a heading disappears with its box');
  assert.ok(!/rotateY\(180deg\)/.test(html), 'no mirrored copy or photo');
});
