import type JSZip from 'jszip';

export const MAX_IMAGES = 80 * 1024 * 1024;
export const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;

/** Bound decompression itself, not just the compressed file size. */
export async function openArchive(file: File) {
  if (file.size > 100 * 1024 * 1024) throw new Error('文件超过 100 MB，请拆分后导入（图片总量上限 80 MB）。');
  const { default: Zip } = await import('jszip');
  let zip: JSZip;
  try { zip = await Zip.loadAsync(await file.arrayBuffer()); }
  catch { throw new Error('无法打开压缩包。请确认文件未损坏、未加密，且格式为 DOCX 或 ZIP。'); }
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > 2000) throw new Error('压缩包条目过多，请拆分后导入。');
  let expanded = 0;
  const cache = new Map<string, Uint8Array>();
  async function read(name: string, limit = 20 * 1024 * 1024): Promise<Uint8Array> {
    const cached = cache.get(name);
    if (cached) return cached;
    const entry = zip.file(name);
    if (!entry) throw new Error(`文档缺少文件：${name}`);
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      // JSZip exposes this streaming API at runtime, but omits it from JSZipObject typings.
      const stream = (entry as typeof entry & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
      stream.on('data', chunk => {
        size += chunk.length;
        expanded += chunk.length;
        if (size > limit || expanded > MAX_EXPANDED) {
          stream.pause();
          reject(new Error('文件解压后超过安全大小限制，请拆分后导入。'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => {
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        resolve(result);
      });
      stream.resume();
    });
    cache.set(name, bytes);
    return bytes;
  }
  async function xml(name: string) {
    const bytes = await read(name);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('文档包含不支持的 XML 声明。');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(`文档 XML 损坏：${name}`);
    return doc;
  }
  return { zip, entries, read, xml };
}
