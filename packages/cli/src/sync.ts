import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';

export interface SyncOptions {
  dataDir: string;
  bucket: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Only these subdirectories of data/, e.g. ['catalog', 'assets']. */
  only?: string[];
  concurrency?: number;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface SyncReport {
  files: number;
  bytes: number;
  skipped: number;
  failed: { key: string; error: string }[];
}

async function walk(dir: string, root: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'modern') continue; // 355 MB of payloads, optional
      await walk(full, root, out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, full));
    }
  }
  return out;
}

/**
 * Upload the local catalog and asset mirror into R2 so the Worker can serve
 * them without touching the upstream CDN.
 */
export async function syncToR2(options: SyncOptions): Promise<SyncReport> {
  const log = options.log ?? (() => {});
  const endpoint = `https://${options.accountId}.r2.cloudflarestorage.com`;
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const root = path.resolve(options.dataDir);
  const files: string[] = [];
  for (const sub of options.only ?? ['catalog', 'assets']) {
    const dir = path.join(root, sub);
    try {
      await walk(dir, root, files);
    } catch {
      log(`skip missing ${dir}`);
    }
  }
  log(`files to upload: ${files.length}`);

  const report: SyncReport = { files: 0, bytes: 0, skipped: 0, failed: [] };
  let cursor = 0;
  const concurrency = options.concurrency ?? 8;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const relative = files[index];
      if (!relative) return;
      const key = relative.split(path.sep).join('/');
      if (options.dryRun) {
        report.skipped++;
        continue;
      }
      try {
        const info = await stat(path.join(root, relative));
        const url = `${endpoint}/${options.bucket}/${key}`;
        const body = createReadStream(path.join(root, relative)) as unknown as ReadableStream;
        const request = await client.sign(url, { method: 'PUT', body, headers: { 'content-length': String(info.size) } });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        report.files++;
        report.bytes += info.size;
        if (report.files % 200 === 0) log(`uploaded ${report.files}/${files.length}`);
      } catch (error) {
        report.failed.push({ key, error: (error as Error).message });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return report;
}
