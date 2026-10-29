import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchBytes, RateLimiter, sleep, type FetchOptions } from './http.ts';
import { assetUrl } from './source.ts';

export interface AssetEntry {
  path: string;
  sha256: string;
  bytes: number;
  sourceUrl: string;
}

export type AssetManifest = Record<string, AssetEntry>;

/** Stable local path for a remote asset URL. */
export function localPathFor(url: string): string {
  const parsed = new URL(url);
  const clean = parsed.pathname.replace(/^\/+/, '');
  return path.posix.join(parsed.hostname, clean);
}

export interface MirrorOptions extends FetchOptions {
  assetsDir: string;
  concurrency?: number;
  rps?: number;
  onProgress?: (done: number, total: number, url: string, manifest: AssetManifest) => void;
  existing?: AssetManifest;
  /** Consecutive failures before the mirror pauses; the CDN soft-blocks bursts. */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
}

export interface MirrorResult {
  manifest: AssetManifest;
  downloaded: number;
  skipped: number;
  failed: { url: string; error: string }[];
}

/** Download every asset once, verifying by digest and reusing prior results. */
export async function mirrorAssets(urls: string[], options: MirrorOptions): Promise<MirrorResult> {
  const manifest: AssetManifest = { ...(options.existing ?? {}) };
  const limiter = new RateLimiter(options.rps ?? 4);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const failed: { url: string; error: string }[] = [];
  let downloaded = 0;
  let skipped = 0;
  let cursor = 0;
  let done = 0;
  let consecutiveFailures = 0;
  let cooldown: Promise<void> | null = null;
  const threshold = options.breakerThreshold ?? 15;
  const cooldownMs = options.breakerCooldownMs ?? 30_000;

  /** Pause every worker once the CDN starts rejecting a burst. */
  const tripBreaker = async (): Promise<void> => {
    if (cooldown) {
      await cooldown;
      return;
    }
    cooldown = sleep(cooldownMs).then(() => {
      cooldown = null;
      consecutiveFailures = 0;
    });
    await cooldown;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const url = urls[index];
      if (!url) return;
      if (cooldown) await cooldown;
      const target = path.join(options.assetsDir, localPathFor(url));
      try {
        const known = manifest[url];
        if (known) {
          const cached = await readFile(path.join(options.assetsDir, known.path)).catch(() => null);
          if (cached) {
            skipped++;
            done++;
            options.onProgress?.(done, urls.length, url, manifest);
            continue;
          }
        }
        // Resume without a manifest: reuse bytes already on the deterministic path.
        const onDisk = await readFile(target).catch(() => null);
        if (onDisk) {
          manifest[url] = {
            path: localPathFor(url),
            sha256: createHash('sha256').update(onDisk).digest('hex'),
            bytes: onDisk.byteLength,
            sourceUrl: url,
          };
          skipped++;
          done++;
          options.onProgress?.(done, urls.length, url, manifest);
          continue;
        }
        const { bytes } = await fetchBytes(url, limiter, {
          cookie: options.cookie,
          retries: 2,
          timeoutMs: 45_000,
        });
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
        manifest[url] = {
          path: localPathFor(url),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.byteLength,
          sourceUrl: url,
        };
        downloaded++;
        consecutiveFailures = 0;
      } catch (error) {
        failed.push({ url, error: (error as Error).message });
        consecutiveFailures++;
        if (consecutiveFailures >= threshold) await tripBreaker();
      } finally {
        done++;
        options.onProgress?.(done, urls.length, url, manifest);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { manifest, downloaded, skipped, failed };
}

/**
 * Point absolute asset URLs at a local mirror prefix.
 * Records keep the original URLs so exported HTML still works inside WeChat;
 * rewriting happens per render request.
 */
export function rewriteAssetUrls(
  html: string,
  manifest: AssetManifest,
  prefix = '/assets',
): string {
  let out = html;
  for (const [remote, entry] of Object.entries(manifest)) {
    if (!out.includes(remote)) continue;
    out = out.split(remote).join(`${prefix}/${entry.path}`);
  }
  return out;
}

export function collectUrls(payloads: { assetUrls: string[] }[]): string[] {
  const set = new Set<string>();
  for (const record of payloads) {
    for (const raw of record.assetUrls) set.add(assetUrl(raw));
  }
  return [...set].sort();
}
