import type { Fingerprint } from '@kiumi/core';
import type { LibraryBlock } from '../../api.ts';

export interface ImportIssue { location: string; message: string }
export interface ImportAsset { file: File; url: string; uploadedUrl?: string }
export interface ImportHint { align?: 'left' | 'center' | 'right'; bold?: boolean; /** px */ size?: number }
export interface ImportItem { block: LibraryBlock; label: string; candidate?: boolean; hint?: ImportHint }
export interface OriginalImage { id: string; name: string; asset: ImportAsset; fp: Fingerprint; reencoded: boolean }
export interface MatchRow {
  /** The low-resolution picture embedded in the Word file. */
  embedded: ImportAsset;
  fp: Fingerprint;
  originalId?: string;
  level: 'high' | 'low' | 'none';
  confidence: number;
  candidates: { id: string; score: number }[];
}
export interface ImportPreview {
  title: string;
  items: ImportItem[];
  assets: ImportAsset[];
  issues: ImportIssue[];
  galleryOnly?: boolean;
  preserveLayout?: boolean;
  /** Word placeholder pictures vs the camera originals shipped in the same ZIP. */
  matching?: { rows: MatchRow[]; originals: OriginalImage[] };
  /** Embedded blob URL -> chosen original blob URL. */
  replacements?: Record<string, string>;
  /** Assets that are decoded for preview but never uploaded (replaced placeholders). */
  hidden?: ImportAsset[];
}
export const issue = (issues: ImportIssue[], location: string, message: string) => issues.push({ location, message });
export function releasePreview(preview: ImportPreview) {
  for (const asset of [...preview.assets, ...(preview.hidden ?? [])]) URL.revokeObjectURL(asset.url);
}
export function imageType(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const head = new TextDecoder().decode(bytes.subarray(0, 12));
  if (/^GIF8[79]a/.test(head)) return 'image/gif';
  if (head.startsWith('RIFF') && head.endsWith('WEBP')) return 'image/webp';
}
export async function addAsset(preview: ImportPreview, bytes: Uint8Array, name: string) {
  const type = imageType(bytes);
  if (!type) throw new Error('图片格式不支持，请转换为 PNG、JPEG、GIF 或 WebP。');
  const file = new File([new Uint8Array(bytes)], name, { type });
  const asset = { file, url: URL.createObjectURL(file) };
  const image = new Image(); image.src = asset.url;
  try { await image.decode(); }
  catch { URL.revokeObjectURL(asset.url); throw new Error('图片文件无法解码，请重新导出或替换图片。'); }
  preview.assets.push(asset);
  return asset;
}
