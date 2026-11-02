import { matchImages, type Fingerprint } from '@kiumi/core';
import { prepareImage } from '../image-match.ts';
import { openArchive, MAX_IMAGES } from './archive.ts';
import { addAsset, issue, releasePreview, type ImportAsset, type ImportPreview, type MatchRow, type OriginalImage } from './model.ts';
import { prepareFile } from './index.ts';

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const skip = (name: string) => name.startsWith('__MACOSX/') || name.split('/').some(part => part.startsWith('.') || part.startsWith('~$'));
const MATCH_ISSUE = '图片匹配';

/**
 * A submission ZIP holds one Word file plus the camera originals. The Word file
 * pictures are placeholders: recognise each one and swap in its original.
 * Returns null when the archive has no Word file (plain gallery ZIP).
 */
export async function prepareBundle(file: File, progress?: (text: string) => void): Promise<ImportPreview | null> {
  const archive = await openArchive(file);
  const names = archive.entries.map(e => e.name).filter(name => !skip(name));
  const docs = names.filter(n => /\.docx$/i.test(n)).sort();
  if (!docs.length) return null;
  const images = names.filter(n => IMAGE.test(n)).sort((a, b) => a.localeCompare(b, 'zh'));

  const docName = docs[0].split('/').at(-1)!;
  const docFile = new File([new Uint8Array(await archive.read(docs[0], 100 * 1024 * 1024))], docName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const preview = await prepareFile(docFile);
  try {
    if (docs.length > 1) issue(preview.issues, 'ZIP', `压缩包内有 ${docs.length} 个 Word 文件，已使用「${docName}」，其余未导入。`);
    const originals: OriginalImage[] = [];
    let total = 0;
    for (let i = 0; i < images.length; i++) {
      const name = images[i].split('/').at(-1)!;
      progress?.(`处理原图 ${i + 1}/${images.length}：${name}`);
      try {
        const raw = await archive.read(images[i], 60 * 1024 * 1024);
        const type = /\.png$/i.test(name) ? 'image/png' : /\.gif$/i.test(name) ? 'image/gif' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
        const prepared = await prepareImage(images[i], new File([new Uint8Array(raw)], name, { type }), { reencode: true });
        total += prepared.bytes.length;
        if (total > MAX_IMAGES) throw new Error('图片总量超过 80 MB，请拆分压缩包。');
        const scratch: ImportPreview = { title: '', items: [], assets: [], issues: [] };
        const asset = await addAsset(scratch, prepared.bytes, prepared.name);
        originals.push({ id: images[i], name, asset, fp: prepared.fingerprint, reencoded: prepared.reencoded });
      } catch (error) { issue(preview.issues, name, `原图无法处理：${(error as Error).message}`); }
    }
    if (!originals.length) { issue(preview.issues, 'ZIP', '压缩包里没有可用的原图，正文使用 Word 内嵌图片。'); return preview; }

    // Fingerprint the embedded placeholders in document order.
    const rows: MatchRow[] = [];
    const sources: Fingerprint[] = [];
    for (let i = 0; i < preview.assets.length; i++) {
      progress?.(`识别 Word 内图片 ${i + 1}/${preview.assets.length}`);
      const asset = preview.assets[i];
      const prepared = await prepareImage(`embedded-${i}`, asset.file);
      sources.push(prepared.fingerprint);
      rows.push({ embedded: asset, fp: prepared.fingerprint, level: 'none', confidence: 0, candidates: [] });
    }
    // Source order follows the document, not asset creation, so sort by first appearance.
    const order = originals.map(o => o.id);
    const matches = matchImages(sources, originals.map(o => o.fp), { order });
    matches.forEach((m, i) => Object.assign(rows[i], { originalId: m.best, level: m.level, confidence: m.confidence, candidates: m.candidates }));
    preview.matching = { rows, originals };
    applyMatching(preview);
    return preview;
  } catch (error) { releasePreview(preview); throw error; }
}

/** Recompute replacements, upload set and notices from the current choices. */
export function applyMatching(preview: ImportPreview) {
  const matching = preview.matching;
  if (!matching) return;
  const byId = new Map(matching.originals.map(o => [o.id, o]));
  const replacements: Record<string, string> = {};
  const hidden: ImportAsset[] = [];
  const keep: ImportAsset[] = [];
  const used = new Set<string>();
  for (const row of matching.rows) {
    const original = row.originalId ? byId.get(row.originalId) : undefined;
    if (original) { replacements[row.embedded.url] = original.asset.url; hidden.push(row.embedded); used.add(original.id); }
    else keep.push(row.embedded);
  }
  // Unused originals still go to the team gallery so nothing is lost.
  const originalAssets = matching.originals.map(o => o.asset);
  preview.replacements = replacements;
  preview.hidden = hidden;
  preview.assets = [...keep, ...originalAssets];
  preview.issues = preview.issues.filter(i => !i.location.startsWith(MATCH_ISSUE));
  matching.rows.forEach((row, i) => {
    const original = row.originalId ? byId.get(row.originalId) : undefined;
    if (!original) issue(preview.issues, `${MATCH_ISSUE} · 第 ${i + 1} 张`, '没有在压缩包里找到对应原图，使用 Word 内嵌的低清图，请补充原图。');
    else if (row.level === 'low') issue(preview.issues, `${MATCH_ISSUE} · 第 ${i + 1} 张`, `与「${original.name}」的相似度不高，请在下方核对是否匹配正确。`);
  });
  const unused = matching.originals.filter(o => !used.has(o.id));
  if (unused.length) issue(preview.issues, `${MATCH_ISSUE} · 未使用`, `压缩包里有 ${unused.length} 张原图没有出现在 Word 中，将放入团队图库备用：${unused.slice(0, 4).map(o => o.name).join('、')}${unused.length > 4 ? '…' : ''}`);
}

export function chooseOriginal(preview: ImportPreview, rowIndex: number, originalId: string | undefined) {
  const row = preview.matching?.rows[rowIndex];
  if (!row) return;
  row.originalId = originalId;
  row.level = originalId ? 'high' : 'none';
  applyMatching(preview);
}
