import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleManuscript, classifyFacts, manuscriptImages, parseDocx } from '../src/index.ts';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const p = (t: string, pr = '', rpr = '') => `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const img = (id: string) => `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const document = `<w:document ${NS}><w:body>${[
  p('直播助力非遗传承，文创赋能乡村振兴', '<w:jc w:val="center"/>', '<w:b/><w:sz w:val="36"/>'),
  p('——走进广州从化罗洞工匠小镇', '<w:jc w:val="right"/>'),
  p('第一段正文内容，足够长以免被识别为标题，并以句号结尾，用于测试结构识别。'),
  img('rId5'),
  p('活动背景', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>', '<w:b/>'),
  img('rId6'), img('rId5'),
  p('第二段正文内容，同样足够长，并以句号结尾。文：梁锦淇 图：李文筑'),
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
].join('')}</w:body></w:document>`;
const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.jpeg"/></Relationships>`;
const numbering = `<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="chineseCounting"/><w:lvlText w:val="%1、"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

test('DOM-free docx parsing keeps order, hints, numbering and media references', () => {
  const r = parseDocx({ document, rels, numbering });
  assert.equal(r.facts.length, 9);
  assert.deepEqual(r.media, ['word/media/image1.jpeg', 'word/media/image2.jpeg']);
  assert.equal(r.facts[0].align, 'center');
  assert.equal(r.facts[0].bold, true);
  assert.equal(r.facts[0].size, 24);
  assert.equal(r.facts[4].numbering, '一、');
  assert.equal(r.facts.at(-1)!.kind, 'table');
  const m = assembleManuscript(r.facts, classifyFacts(r.facts));
  assert.equal(m.title, '直播助力非遗传承，文创赋能乡村振兴');
  assert.equal(m.byline?.writer, '梁锦淇');
  assert.deepEqual(manuscriptImages(m), ['word/media/image1.jpeg', 'word/media/image2.jpeg', 'word/media/image1.jpeg']);
  assert.equal(m.sections.some(s => s.heading === '一、 活动背景'), true);
});
