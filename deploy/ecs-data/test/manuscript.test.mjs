import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// The data service has its own node_modules (npm ci in deploy/ecs-data); skip when it is not installed.
let JSZip, sharp, importManuscript;
const available = await (async () => {
  try { JSZip = (await import('jszip')).default; sharp = (await import('sharp')).default; ({ importManuscript } = await import('../manuscript.mjs')); return true; }
  catch { return false; }
})();
const test = (name, fn) => (available ? baseTest(name, fn) : baseTest(name, { skip: 'run npm ci in deploy/ecs-data' }, () => {}));

// Deterministic, visibly different "photos".
const photo = (seed, w, h) => {
  const circles = Array.from({ length: 6 }, (_, i) => `<circle cx="${((seed * 97 + i * 131) % 100) / 100 * w}" cy="${((seed * 53 + i * 71) % 100) / 100 * h}" r="${(0.06 + ((seed + i) % 5) * 0.04) * w}" fill="hsl(${(seed * 41 + i * 57) % 360},80%,${30 + (i * 11 + seed * 7) % 50}%)"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${seed * 83 % 360},70%,45%)"/><stop offset="1" stop-color="hsl(${(seed * 83 + 120) % 360},60%,70%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${circles}</svg>`);
};
const jpeg = (svg, q) => sharp(svg).jpeg({ quality: q }).toBuffer();

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const p = t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const img = id => `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

test('placeholders find their camera originals and are stored article-ready', async () => {
  const docx = new JSZip();
  docx.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="i1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.jpeg"/><Relationship Id="i2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/b.jpeg"/></Relationships>');
  docx.file('word/media/a.jpeg', await jpeg(photo(3, 240, 180), 40));
  docx.file('word/media/b.jpeg', await jpeg(photo(1, 240, 180), 40));
  docx.file('word/document.xml', `<?xml version="1.0"?><w:document ${NS}><w:body>${[p('直播助力非遗传承'), p('第一段正文内容，足够长以免被识别为标题，并以句号结尾，用于测试。'), img('i1'), img('i2')].join('')}</w:body></w:document>`);
  const zip = new JSZip();
  zip.file('稿件/稿件.docx', await docx.generateAsync({ type: 'nodebuffer' }));
  for (const n of [1, 2, 3]) zip.file(`稿件/photo_${n}.jpg`, await jpeg(photo(n, 3200, 2400), 92));
  const dir = await mkdtemp(path.join(tmpdir(), 'kiumi-ms-'));
  const file = path.join(dir, 'in.zip');
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const team = 'team_0123abcd-0000-4000-8000-000000000001';
  const r = await importManuscript({ file, team, root: dir });
  assert.deepEqual(r.matches.map(m => m.original), ['photo_3.jpg', 'photo_1.jpg']);
  assert.ok(r.matches.every(m => m.level === 'high' || m.level === 'low'));
  assert.deepEqual(r.unused.map(u => u.name), ['photo_2.jpg']);
  assert.equal(r.facts.length, 4);
  // Stored files are resized and keyed in the Worker's scheme.
  const stored = await readdir(path.join(dir, 'uploads', team));
  assert.equal(stored.length, 3);
  assert.ok(stored.every(n => /^img_[a-f0-9]{64}\.jpeg$/.test(n)));
  const meta = await sharp(path.join(dir, r.refs['word/media/a.jpeg'].key)).metadata();
  assert.equal(Math.max(meta.width, meta.height), 2000);
  assert.equal(meta.exif, undefined);
});

test('a Word file without originals falls back to its own pictures and says so', async () => {
  const docx = new JSZip();
  docx.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="i1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.jpeg"/></Relationships>');
  docx.file('word/media/a.jpeg', await jpeg(photo(5, 240, 180), 60));
  docx.file('word/document.xml', `<w:document ${NS}><w:body>${p('只有 Word')}${img('i1')}</w:body></w:document>`);
  const dir = await mkdtemp(path.join(tmpdir(), 'kiumi-ms-'));
  const file = path.join(dir, 'in.docx');
  await writeFile(file, await docx.generateAsync({ type: 'nodebuffer' }));
  const r = await importManuscript({ file, team: 'team_0123abcd-0000-4000-8000-000000000001', root: dir });
  assert.equal(r.matches[0].original, null);
  assert.equal(r.matches[0].level, 'none');
});
