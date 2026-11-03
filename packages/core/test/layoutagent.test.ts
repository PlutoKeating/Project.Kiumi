import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPolish, assembleManuscript, classifyFacts, executePlan, autoPlan, analyzeTemplate, manuscriptPieces, inspectElement, layoutFindings, numberElements, parseAgentReply, stripAgentMarks, fillTemplate, type SourceFact } from '../src/index.ts';

const ph = (n: number) => '正文' + ' ​'.repeat(n);
const unit = (inner: string) => `<div style="position:static"><section>${inner}</section></div>`;
const T = (i: number, t: string): SourceFact => ({ i, kind: 'text', text: t, html: `<p>${t}</p>` });
const I = (i: number, ref: string): SourceFact => ({ i, kind: 'image', text: '', html: '', images: [ref] });
const sample = '/assets/x/y/mat/i/fvId/sample_sz-773899.jpg';
// A title boxed at a fixed height (it will be clipped), body, a photo slot, a second photo slot the plan leaves alone.
const tpl = `<section>${[
  unit(`<div style="height:60px;overflow:hidden"><div style="font-size:200%;color:rgb(201, 6, 4)"><p>${ph(6)}</p></div></div>`),
  unit(`<div><p>${ph(60)}</p></div>`),
  unit(`<div><img src="${sample}" style="width:100%"></div>`),
  unit(`<div><p>${ph(60)}</p></div>`),
].join('')}</section>`;
const facts = [T(0, '直播助力非遗传承，文创赋能乡村振兴'), T(1, '第一段正文内容，足够长以免被识别为标题，并以句号结尾。'), I(2, 'a'), T(3, '第二段正文内容，同样足够长，并以句号结尾。')];
const m = assembleManuscript(facts, classifyFacts(facts));
// The executor output, plus what review rounds meet in real templates: a sample photo it could not tell
// from art, and a title box frozen at a fixed height.
const working = () => numberElements(executePlan(tpl, m, autoPlan(analyzeTemplate(tpl), manuscriptPieces(m)), { mark: true, resolveImage: r => `/uploads/${r}.jpg` }).html
  .replace('<div style=";overflow:visible">', '<div style="height:60px;overflow:hidden">')
  .replace(/<\/section>$/, `<div><img src="${sample}" style="width:100%"></div></section>`));
const kOf = (html: string, re: RegExp) => Number(re.exec(html)?.[1]);

test('content marks are kept only for the review loop, never in published HTML', () => {
  const marked = executePlan(tpl, m, autoPlan(analyzeTemplate(tpl), manuscriptPieces(m)), { mark: true, resolveImage: r => `/uploads/${r}.jpg` }).html;
  assert.match(marked, /data-kiumi="T"/);
  assert.match(marked, /data-kiumi="p0"/);
  assert.match(marked, /<img data-kiumi="f0"|data-kiumi="f0"[^>]*src="\/uploads\/a\.jpg"|src="\/uploads\/a\.jpg"[^>]*data-kiumi="f0"/);
  assert.match(marked, /data-kiumi-u="u0 title"/);
  const plain = fillTemplate(tpl, m, { resolveImage: r => `/uploads/${r}.jpg` }).html;
  assert.ok(!/data-kiumi|data-k=/.test(plain));
  assert.equal(stripAgentMarks(numberElements(marked)), stripAgentMarks(marked));
});

test('agent replies are read leniently and every tool is checked for its arguments', () => {
  assert.deepEqual(parseAgentReply('好的\n```json\n{"thought":"标题被裁","action":{"tool":"style","k":"#12","css":"height:auto; overflow:visible"}}\n```'),
    { thought: '标题被裁', action: { tool: 'style', k: 12, css: { height: 'auto', overflow: 'visible' } } });
  assert.equal((parseAgentReply('{"thought":"x","action":{"tool":"finish","summary":"满意"}}') as any).action.summary, '满意');
  assert.match((parseAgentReply('没有 JSON') as any).error, /没有找到 JSON/);
  assert.match((parseAgentReply('{"action":{"tool":"fly"}}') as any).error, /未知工具/);
  assert.match((parseAgentReply('{"action":{"tool":"remove"}}') as any).error, /需要元素编号/);
  assert.equal((parseAgentReply('{"action":{"tool":"set_plan","entries":[{"u":0,"t":{"0":["T"]}}]}}') as any).action.entries[0].u, 0);
});

test('polish actions cannot hide, drop or restyle manuscript content against the house rules', () => {
  const html = working();
  const title = kOf(html, /data-kiumi="T"[^>]*data-k="(\d+)"|data-k="(\d+)"[^>]*data-kiumi="T"/);
  const body = kOf(html, /<section data-kiumi="p0"[^>]*data-k="(\d+)"/);
  const photo = kOf(html, /<img[^>]*data-kiumi="f0"[^>]*data-k="(\d+)"/);
  const sampleK = kOf(html, new RegExp(`<img src="${sample}"[^>]*data-k="(\\d+)"`));
  assert.ok(title && body && photo && sampleK, 'all elements numbered');
  const ctx = { title: '直播助力非遗传承 文创赋能乡村振兴', subtitle: undefined };

  assert.match((applyPolish(html, { tool: 'remove', k: body }) as any).error, /含有稿件内容/);
  assert.match((applyPolish(html, { tool: 'style', k: body, css: { display: 'none' } }) as any).error, /不能隐藏/);
  assert.match((applyPolish(html, { tool: 'style', k: body, css: { color: '#666666' } }) as any).error, /由团队规范固定/);
  assert.match((applyPolish(html, { tool: 'style', k: body + 1, css: { 'font-size': '16px' } }) as any).error, /由团队规范固定/, 'inner paragraphs of a body piece too');
  assert.match((applyPolish(html, { tool: 'style', k: photo, css: { width: '50%' } }) as any).error, /宽度由规范固定为 90%/);
  assert.match((applyPolish(html, { tool: 'style', k: title, css: { 'font-family': 'serif' } }) as any).error, /不允许修改 font-family|秀米默认字体/);
  assert.match((applyPolish(html, { tool: 'style', k: title, css: { background: 'url(x)' } }) as any).error, /不允许修改 background/);
  assert.match((applyPolish(html, { tool: 'set_text', k: body, text: '改写的正文' }) as any).error, /只能用于标题行/);
  assert.match((applyPolish(html, { tool: 'set_text', k: title, text: '另一个标题' }, ctx) as any).error, /标题文字必须是/);
  assert.match((applyPolish(html, { tool: 'style', k: 9999, css: { height: 'auto' } }) as any).error, /没有编号/);

  // What a designer would do is allowed: free the clipped title box, resize the title, re-break it, drop the sample photo.
  const box = kOf(html, /<div style="height:60px;overflow:hidden" data-k="(\d+)"/);
  const freed = applyPolish(html, { tool: 'style', k: box, css: { height: 'auto', overflow: 'visible' } });
  assert.ok('html' in freed && /height:auto;overflow:visible/.test(freed.html));
  assert.ok('html' in applyPolish(html, { tool: 'style', k: title, css: { 'font-size': '26px', color: 'rgb(180, 0, 0)' } }, ctx));
  const rebroken = applyPolish(html, { tool: 'set_text', k: title, text: '直播助力非遗传承\n文创赋能乡村振兴' }, ctx);
  assert.ok('html' in rebroken && /直播助力非遗传承<br>文创赋能乡村振兴/.test(rebroken.html));
  const removed = applyPolish(html, { tool: 'remove', k: sampleK });
  assert.ok('html' in removed && !removed.html.includes(sample));
  assert.match(inspectElement(html, title), /内容：T/);
});

test('findings without a browser: sample photos left behind, placeholder padding and house-rule lint', () => {
  const html = working();
  const found = layoutFindings(html);
  assert.ok(found.some(f => f.level === 'error' && /样例照片/.test(f.message)), JSON.stringify(found));
  const removed = applyPolish(html, { tool: 'remove', k: kOf(html, new RegExp(`<img src="${sample}"[^>]*data-k="(\\d+)"`)) });
  assert.ok('html' in removed);
  assert.ok(!layoutFindings(removed.html).some(f => /样例照片/.test(f.message)));
  const grey = html.replace('color:#000000', 'color:#666666');
  assert.ok(layoutFindings(grey).some(f => /深灰/.test(f.message)));
});

test('SVG boxes are resized through their attributes, since CSS does not size them', () => {
  const html = numberElements('<section><svg viewBox="0 0 383 400" data-kiumi-u="u0 title"><svg height="22.73%" width="90%"><foreignobject width="100%" height="100%"><div><p data-kiumi="T">标题</p></div></foreignobject></svg></svg></section>');
  const inner = Number(/<svg height="22.73%" width="90%" data-k="(\d+)"/.exec(html)![1]);
  const done = applyPolish(html, { tool: 'style', k: inner, css: { height: '40%' } });
  assert.ok('html' in done);
  assert.match(done.html, /<svg height="40%" width="90%"/);
  assert.match(done.done, /属性/);
});
