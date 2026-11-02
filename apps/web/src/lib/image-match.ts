import { THUMB, fingerprint, type Fingerprint } from '@kiumi/core';

/** Longest edge kept for images that go into an article (WeChat shows ~677 px wide). */
export const MAX_EDGE = 2000;
export const KEEP_BYTES = 1.5 * 1024 * 1024;

function canvasOf(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

async function toBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片编码失败'))), type, quality));
}

export interface Prepared {
  fingerprint: Fingerprint;
  /** Bytes to upload: the original when small enough, otherwise a resized JPEG without EXIF. */
  bytes: Uint8Array;
  name: string;
  type: string;
  reencoded: boolean;
}

/**
 * Decode once, fingerprint, and shrink when the picture is too heavy for an
 * article. Re-encoding through a canvas also drops EXIF (including GPS).
 */
export async function prepareImage(id: string, file: File, options: { reencode?: boolean } = {}): Promise<Prepared> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = bitmap;
    const thumb = canvasOf(THUMB, THUMB);
    const t = thumb.getContext('2d') as CanvasRenderingContext2D;
    t.imageSmoothingEnabled = true; t.imageSmoothingQuality = 'high';
    t.drawImage(bitmap, 0, 0, THUMB, THUMB);
    const data = t.getImageData(0, 0, THUMB, THUMB).data;
    const gray = new Uint8Array(THUMB * THUMB);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    const fp = fingerprint(id, gray, width, height);
    const isJpeg = /jpe?g/i.test(file.type);
    const heavy = file.size > KEEP_BYTES || Math.max(width, height) > MAX_EDGE;
    if (options.reencode && (heavy || isJpeg) && file.type !== 'image/gif') {
      const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      const canvas = canvasOf(w, h);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await toBlob(canvas, 'image/jpeg', 0.85);
      if (blob.size < file.size || heavy || isJpeg) {
        return { fingerprint: fp, bytes: new Uint8Array(await blob.arrayBuffer()), name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', reencoded: true };
      }
    }
    return { fingerprint: fp, bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type, reencoded: false };
  } finally { bitmap.close(); }
}
