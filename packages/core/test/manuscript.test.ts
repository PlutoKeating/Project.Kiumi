import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotationRequest, applyAnnotations, assembleManuscript, classifyFacts, manuscriptImages, outlineOf, splitTrailingByline, type SourceFact } from '../src/index.ts';

const t = (i: number, text: string, extra: Partial<SourceFact> = {}): SourceFact => ({ i, kind: 'text', text, html: `<p>${text}</p>`, ...extra });
const img = (i: number, ref: string): SourceFact => ({ i, kind: 'image', text: '', html: '', images: [ref] });

// Mirrors the real sample: unstyled title, dash subtitle, figures between paragraphs, byline glued to the end.
const sample: SourceFact[] = [
  t(0, '直播助力非遗传承，文创赋能乡村振兴'),
  t(1, '——走进广州从化罗洞工匠小镇', { align: 'right' }),
  t(2, '在华南农业大学珠江学院数字经济产业学院、智能会计产业学院的支持下开展了“匠心传文脉，直播展非遗”为主题的研学实践活动。'),
  t(3, '2026 年 10 月 21 日，华南农业大学珠江学院师生走进广州市从化区罗洞工匠小镇，开展特色产品直播推广活动。活动由指导老师带队，学生与当地工作人员共同参与。'),
  img(4, 'img-1'),
  t(5, '在指导老师的带领下，学生与当地工作人员共同参与活动，围绕产品展示和文化传播开展实践。对学生而言，此次活动不仅是一次接触直播推广的实践机会。'),
  img(6, 'img-2'),
  img(7, 'img-3'),
  t(8, '活动期间，通过直播推广草坪机动车等其他文创活动开展直播，通过线上展示与宣传，拓展了直播推广的场景。'),
  t(9, '未来，华南农业大学珠江学院师生将继续关注传统文化传播与数字营销的融合发展，以实际行动助力传统工艺的传播与创新，为地方文化发展贡献青春力量。文：梁锦淇 图：李文筑'),
];

test('rules recover title, subtitle, byline and figure order without styles', () => {
  const c = classifyFacts(sample);
  assert.equal(c[0].role, 'title');
  assert.equal(c[1].role, 'subtitle');
  const m = assembleManuscript(sample, c);
  assert.equal(m.title, '直播助力非遗传承，文创赋能乡村振兴');
  assert.equal(m.subtitle, '——走进广州从化罗洞工匠小镇');
  assert.equal(m.byline?.writer, '梁锦淇');
  assert.equal(m.byline?.photographer, '李文筑');
  assert.deepEqual(manuscriptImages(m), ['img-1', 'img-2', 'img-3']);
  // Last paragraph keeps its body text and loses the byline.
  const last = m.sections.at(-1)!.parts.at(-1)!;
  assert.ok(last.type === 'p' && last.text.endsWith('贡献青春力量。'));
});

test('hand-typed numbering ladders become heading levels', () => {
  const facts = [
    t(0, '活动总结', { align: 'center', bold: true }),
    t(1, '一、活动背景'),
    t(2, '这是一段足够长的正文内容，用于避免被当成标题，并且以句号结尾。'),
    t(3, '（一）直播准备'),
    t(4, '又一段足够长的正文内容，同样以句号结尾，说明准备工作的情况。'),
    t(5, '二、活动成效'),
  ];
  const c = classifyFacts(facts);
  assert.deepEqual(c.map(x => x.role), ['title', 'heading', 'body', 'heading', 'body', 'heading']);
  assert.deepEqual([c[1].level, c[3].level, c[5].level], [1, 2, 1]);
  assert.equal(assembleManuscript(facts, c).sections.length, 3);
});

test('uncertain lines are the only ones sent to the model, and patches apply', () => {
  const facts = [t(0, '活动总结', { align: 'center' }), t(1, '活动背景'), t(2, '正文很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。')];
  const c = classifyFacts(facts);
  const req = annotationRequest(facts, c);
  assert.ok(req.ask.includes(1));
  assert.ok(!req.ask.includes(2));
  assert.ok(req.prompt.length < 400);
  const patched = applyAnnotations(c, [[1, 'h1'], [2, 'zzz'], [99, 'h1']]);
  assert.equal(patched[1].role, 'heading');
  assert.equal(patched[2].role, 'body');
  assert.match(outlineOf(assembleManuscript(facts, patched)).join('\n'), /活动背景/);
});

test('splitTrailingByline leaves ordinary colons alone', () => {
  assert.equal(splitTrailingByline('会议提出：加强合作，推动发展。'), null);
  assert.equal(splitTrailingByline('收尾。文：甲 图：乙')?.body, '收尾。');
});
