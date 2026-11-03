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

test('a smaller line in the title unit takes the subtitle; a long title breaks at its comma', () => {
  // ph(6) is a 14-character headline, ph(2) a 6-character pill, as in shop templates.
  const title = unit(`<div style="font-size:200%"><p><span style="color:rgb(149, 73, 49)">${ph(6)}</span></p></div><div style="border:1px solid"><p>${ph(2)}</p></div>`);
  // Photo and copy in separate wrappers of one framed card.
  const card = unit(`<div style="border:1px solid;padding:15px"><div><section><img src="/assets/x/y/mat/i/fvId/abc_sz-773899.jpg" style="width:100%"></section></div><div><section><p>${ph(120)}</p></section></div></div>`);
  const tpl = `<section>${[title, text(120), card, text(120)].join('')}</section>`;
  assert.deepEqual(analyzeTemplate(tpl).units.map(u => u.kind), ['title', 'text', 'mixed', 'text']);
  const f = [
    T(0, '直播助力非遗传承，文创赋能乡村振兴'),
    T(1, '——走进广州从化罗洞工匠小镇'),
    T(2, '第一段正文内容，足够长以免被识别为标题，并以句号结尾。'),
    I(3, 'a'),
    T(4, '第二段正文内容，同样足够长，并以句号结尾。'),
  ];
  const m = assembleManuscript(f, classifyFacts(f));
  assert.equal(m.subtitle, '——走进广州从化罗洞工匠小镇');
  const { html, report } = fillTemplate(tpl, m, { resolveImage: r => `/uploads/${r}.jpg` });
  assert.match(html, /直播助力非遗传承<br>文创赋能乡村振兴/);
  assert.match(html, />走进广州从化罗洞工匠小镇</);
  assert.ok(!html.includes('——走进'), 'the pill drops the dash and the subtitle is not repeated');
  assert.equal(report.spilled, 0);
  assert.equal(report.subtitle, true);
  const between = html.slice(html.indexOf('/uploads/a.jpg'), html.indexOf('第二段正文'));
  assert.match(between, /<br>/, 'blank line between the photo and its copy inside the card');
});

test('a subtitle without a slot is a black display line under the title, not body text', () => {
  const title = unit(`<div style="font-size:200%"><p><span style="color:rgb(149, 73, 49)">${ph(14)}</span></p></div>`);
  const tpl = `<section>${[title, text(120), photo, text(120)].join('')}</section>`;
  const f = [
    T(0, '直播助力非遗传承'),
    T(1, '——走进广州从化罗洞工匠小镇'),
    T(2, '第一段正文内容，足够长以免被识别为标题，并以句号结尾。'),
    I(3, 'a'),
    T(4, '第二段正文内容，同样足够长，并以句号结尾。'),
  ];
  const { html, report } = fillTemplate(tpl, assembleManuscript(f, classifyFacts(f)), { resolveImage: r => `/uploads/${r}.jpg` });
  assert.match(html, /<p style="[^"]*font-size:16px;font-weight:bold;line-height:2;letter-spacing:2px;color:#000000;">——走进广州从化罗洞工匠小镇<\/p>/);
  assert.equal(html.split('走进广州从化罗洞工匠小镇').length, 2, 'set once');
  assert.ok(html.indexOf('走进广州') < html.indexOf('第一段正文'));
  assert.equal(report.spilled, 0);
  const around = (a: string, b: string) => html.slice(html.indexOf(a), html.indexOf(b));
  assert.match(around('第一段正文', '/uploads/a.jpg'), /<br>/);
  assert.match(around('/uploads/a.jpg', '第二段正文'), /<br>/);
});

test('house rules hold on template text: black, default font, sizes, spacing, 90% pictures and blank lines', () => {
  const font = 'font-family:&quot;Noto Serif&quot;, serif;';
  const title = unit(`<div style="font-size:200%"><p><span style="color:rgb(149, 73, 49)">${ph(6)}</span></p></div>`);
  // A heading bar in the template's colour and font at 21px, and a light label on a colour band.
  const heading = unit(`<div style="${font}color:rgb(149, 73, 49);font-size:133%"><p><strong>${ph(4)}</strong></p></div>`);
  const band = unit(`<div style="background-color:rgb(149, 73, 49)"><p style="color:#ffffff;font-size:18px">${ph(4)}</p></div>`);
  // The text unit is the template paragraph itself, with its own gap and font.
  const para = `<p style="margin-bottom: 10px;${font}"><span style="color:rgb(127, 127, 127)">${ph(60)}</span></p>`;
  const spacer = unit('<div><p><br></p></div>');
  const pic = unit('<div style="display:inline-block;width:300px"><img src="/assets/x/y/mat/i/fvId/abc_sz-773899.jpg"></div>');
  const tpl = `<section>${[title, text(120), heading, spacer, para, band, text(120), pic, text(120)].join('')}</section>`;
  const f = [
    T(0, '直播助力非遗传承'),
    T(1, '一、活动背景'),
    T(2, '第一段正文内容，足够长以免被识别为标题，并以句号结尾。'),
    T(3, '二、活动过程'),
    T(4, '第二段正文内容，同样足够长，并以句号结尾。'),
    I(5, 'a'),
    T(6, '第三段正文内容，同样足够长，并以句号结尾。'),
  ];
  const m = assembleManuscript(f, classifyFacts(f));
  const plan = [{ u: 0, t: { 0: ['T'] } }, { u: 2, t: { 0: ['h0'] } }, { u: 4, t: { 0: ['p0'] } }, { u: 5, t: { 0: ['h1'] } }, { u: 6, t: { 0: ['p1'] } }, { u: 7, img: ['f0'] }, { u: 8, t: { 0: ['p2'] } }];
  const { html } = executePlan(tpl, m, plan, { resolveImage: r => `/uploads/${r}.jpg` });
  const body = html.replace(/<div style="font-size:200%">[\s\S]*?<\/div>/, '');
  assert.ok(!/font-family/.test(body), 'template fonts do not reach filled text');
  assert.ok(!/rgb\(127, 127, 127\)/.test(html), 'no grey text');
  assert.ok(!/margin-bottom: 10px/.test(html), 'paragraph gap 0');
  assert.ok(!/<p[^>]*>\s*<section/.test(html), 'no paragraphs nested in a <p>');
  assert.match(html, /<p style="[^"]*color:#000000;line-height:2;letter-spacing:2px;font-size:16px;font-weight:bold;"><strong>一、活动背景<\/strong><\/p>/);
  assert.match(html, /<p style="color:#ffffff;line-height:2;letter-spacing:2px;font-size:16px;font-weight:bold;">二、活动过程<\/p>/, 'light text on a colour band keeps its colour');
  assert.match(html, /<img src="\/uploads\/a.jpg" style="width:90%;max-width:90%;/);
  assert.ok(!/width:300px/.test(html), 'the picture holder spans the slot');
  // 文字和文字不用空行: the template spacer between the heading and its text is gone.
  assert.equal(html.slice(html.indexOf('一、活动背景'), html.indexOf('第一段正文')).includes('<br>'), false);
  const around = (a: string, b: string) => html.slice(html.indexOf(a), html.indexOf(b));
  assert.match(around('第二段正文', '/uploads/a.jpg'), /<br>/);
  assert.match(around('/uploads/a.jpg', '第三段正文'), /<br>/);
  assert.ok(!/<br><\/p>\s*<p[^>]*><br><\/p>/.test(html), 'never two blank lines in a row');
  assert.ok(html.startsWith('<section><p style="margin:0;line-height:2;font-size:14px;"><br></p>'), 'blank line first');
  assert.ok(html.endsWith('<p style="margin:0;line-height:2;font-size:14px;"><br></p></section>'), 'blank line last');
  assert.match(html, /<p style="font-weight:bold;"><span style="color:rgb\(149, 73, 49\)">直播助力非遗传承<\/span><\/p>/, 'the title keeps the template look and is bold');
});
