// Submission-ZIP importer for the data service: unzip, read the Word file, match its
// placeholder pictures to the camera originals, and store article-ready images.
// Needs Node + sharp, so it lives here rather than in the Worker.
import { mkdir, writeFile, rename, unlink, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { parseDocx } from './core/docxfacts.ts';
import { fingerprint, matchImages, THUMB } from './core/imagematch.ts';

sharp.cache(false);
sharp.concurrency(1);

const MAX_EDGE = 2000;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const skip = name => name.startsWith('__MACOSX/') || name.split('/').some(part => part.startsWith('.') || part.startsWith('~$'));

/** 32x32 luminance thumbnail (EXIF orientation applied) plus the true oriented size. */
export async function thumbOf(bytes) {
  const image = sharp(bytes, { limitInputPixels: 120_000_000, failOn: 'none' });
  const meta = await image.metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
  const { data } = await image.rotate().resize(THUMB, THUMB, { fit: 'fill', kernel: 'lanczos3' }).flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { gray: new Uint8Array(data), width, height };
}

/** Article-ready bytes: oriented, <= 2000 px, no EXIF. GIFs are kept as they are. */
export async function articleBytes(bytes, name) {
  const type = /\.png$/i.test(name) ? 'png' : /\.gif$/i.test(name) ? 'gif' : /\.webp$/i.test(name) ? 'webp' : 'jpeg';
  if (type === 'gif') return { bytes, type };
  let pipeline = sharp(bytes, { limitInputPixels: 120_000_000, failOn: 'none' }).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
  pipeline = type === 'png' ? pipeline.png({ compressionLevel: 9 }) : type === 'webp' ? pipeline.webp({ quality: 85 }) : pipeline.flatten({ background: '#fff' }).jpeg({ quality: 85 });
  return { bytes: await pipeline.toBuffer(), type };
}

/** Same id scheme as the Worker's /api/assets/upload, so both paths dedupe together. */
export function uploadKey(team, bytes, type) {
  const id = `img_${sha256(Buffer.from(`${team}:${sha256(bytes)}`))}`;
  return { id, key: `uploads/${team}/${id}.${type}` };
}

async function store(root, key, bytes) {
  const target = path.resolve(root, key);
  if (!target.startsWith(path.resolve(root, 'uploads') + path.sep)) throw new Error('invalid key');
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, bytes, { flag: 'wx' }); await rename(tmp, target); } finally { await unlink(tmp).catch(() => {}); }
}

export async function importManuscript({ file, team, root }) {
  if (!/^team_[a-f0-9-]+$/.test(team)) throw new Error('invalid team');
  const outer = await JSZip.loadAsync(await readFile(file));
  const names = Object.values(outer.files).filter(e => !e.dir && !skip(e.name)).map(e => e.name);
  const warnings = [];
  let docx = outer, docName = '稿件.docx';
  if (!outer.file('word/document.xml')) {
    const docs = names.filter(n => /\.docx$/i.test(n)).sort();
    if (!docs.length) throw new Error('压缩包里没有 Word 文件（.docx）');
    if (docs.length > 1) warnings.push(`压缩包内有 ${docs.length} 个 Word 文件，已使用「${docs[0].split('/').at(-1)}」。`);
    docName = docs[0].split('/').at(-1);
    docx = await JSZip.loadAsync(await outer.file(docs[0]).async('nodebuffer'));
  }
  const text = async f => (docx.file(f) ? docx.file(f).async('string') : undefined);
  const parsed = parseDocx({ document: await text('word/document.xml'), styles: await text('word/styles.xml'), numbering: await text('word/numbering.xml'), rels: await text('word/_rels/document.xml.rels') });
  warnings.push(...parsed.warnings);

  // Placeholders embedded in the Word file.
  const placeholders = [];
  for (const ref of parsed.media) {
    const bytes = await docx.file(ref)?.async('nodebuffer');
    if (!bytes) { warnings.push(`Word 内图片 ${ref} 缺失。`); continue; }
    const t = await thumbOf(bytes);
    placeholders.push({ ref, bytes, fp: fingerprint(ref, t.gray, t.width, t.height) });
  }

  // Originals shipped beside the Word file (only when the Word file sits inside a ZIP).
  const imageNames = outer === docx ? [] : names.filter(n => IMAGE.test(n)).sort((a, b) => a.localeCompare(b, 'zh'));
  const originals = [];
  let total = 0;
  for (const name of imageNames) {
    const raw = await outer.file(name).async('nodebuffer');
    try {
      const t = await thumbOf(raw);
      const out = await articleBytes(raw, name);
      total += out.bytes.length;
      if (total > 80 * 1024 * 1024) throw new Error('图片总量超过 80 MB');
      const { id, key } = uploadKey(team, out.bytes, out.type);
      await store(root, key, out.bytes);
      originals.push({ name: name.split('/').at(-1), id, key, mime: `image/${out.type}`, bytes: out.bytes.length, sha256: sha256(out.bytes), fp: fingerprint(name, t.gray, t.width, t.height), width: t.width, height: t.height });
    } catch (error) { warnings.push(`原图 ${name.split('/').at(-1)} 无法处理：${error.message}`); }
  }

  const results = originals.length ? matchImages(placeholders.map(p => p.fp), originals.map(o => o.fp), { order: originals.map(o => o.fp.id) }) : [];
  const byFp = new Map(originals.map(o => [o.fp.id, o]));
  const refs = {};
  const matches = [];
  for (let i = 0; i < placeholders.length; i++) {
    const p = placeholders[i];
    const m = results[i];
    const original = m?.best ? byFp.get(m.best) : undefined;
    if (original) {
      refs[p.ref] = { id: original.id, key: original.key, mime: original.mime, bytes: original.bytes, sha256: original.sha256, name: original.name };
      matches.push({ ref: p.ref, original: original.name, level: m.level, confidence: Math.round(m.confidence * 100) / 100, candidates: m.candidates.map(c => ({ name: byFp.get(c.id)?.name, score: Math.round(c.score * 100) / 100 })) });
    } else {
      // No original: keep the Word picture itself (re-encoded), flagged for the caller.
      const out = await articleBytes(p.bytes, p.ref);
      const { id, key } = uploadKey(team, out.bytes, out.type);
      await store(root, key, out.bytes);
      refs[p.ref] = { id, key, mime: `image/${out.type}`, bytes: out.bytes.length, sha256: sha256(out.bytes), name: p.ref.split('/').at(-1) };
      matches.push({ ref: p.ref, original: null, level: 'none', confidence: m ? Math.round(m.confidence * 100) / 100 : 0, candidates: (m?.candidates ?? []).map(c => ({ name: byFp.get(c.id)?.name, score: Math.round(c.score * 100) / 100 })) });
    }
  }
  const used = new Set(matches.map(m => m.original).filter(Boolean));
  return {
    docName,
    facts: parsed.facts,
    warnings,
    refs,
    matches,
    unused: originals.filter(o => !used.has(o.name)).map(o => ({ name: o.name, id: o.id, key: o.key, mime: o.mime, bytes: o.bytes, sha256: o.sha256 })),
  };
}
