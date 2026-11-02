// Vendored from packages/core/src/imagematch.ts. Do not edit: run `pnpm sync:ecs-core`.
/**
 * Match low-resolution placeholders (images embedded in a Word file, already
 * recompressed) to the original camera files shipped beside it.
 *
 * Pure and decoder-free: adapters (canvas in the browser, sharp on a server)
 * hand over a small grayscale thumbnail plus the true pixel size, and this
 * module does hashing, scoring and assignment.
 */

export const THUMB = 32;

export interface Fingerprint {
  id: string;
  /** Original pixel size, EXIF orientation already applied. */
  width: number;
  height: number;
  /** 64-bit difference hash, 16 hex chars. */
  dhash: string;
  /** 64-bit mean hash, 16 hex chars. */
  ahash: string;
  /** 16-bin luminance histogram, sums to 1. */
  hist: number[];
}

export interface Candidate {
  id: string;
  score: number;
}

export interface ImageMatch {
  /** Source id (the placeholder). */
  source: string;
  best?: string;
  /** 0..1 */
  confidence: number;
  /** `high` can be applied silently; `low` should be flagged yellow. */
  level: 'high' | 'low' | 'none';
  candidates: Candidate[];
}

/** Area-average resample of a `sw x sh` gray grid to `w x h`. */
export function resizeGray(src: ArrayLike<number>, sw: number, sh: number, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = (y * sh) / h, y1 = ((y + 1) * sh) / h;
    for (let x = 0; x < w; x++) {
      const x0 = (x * sw) / w, x1 = ((x + 1) * sw) / w;
      let sum = 0, weight = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const k = wx * wy;
          sum += src[yy * sw + xx] * k;
          weight += k;
        }
      }
      out[y * w + x] = weight ? sum / weight : 0;
    }
  }
  return out;
}

function bitsToHex(bits: boolean[]): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += ((bits[i] ? 8 : 0) | (bits[i + 1] ? 4 : 0) | (bits[i + 2] ? 2 : 0) | (bits[i + 3] ? 1 : 0)).toString(16);
  return hex;
}

/** `gray` is a THUMB x THUMB luminance grid (0..255), already de-rotated. */
export function fingerprint(id: string, gray: ArrayLike<number>, width: number, height: number, side = THUMB): Fingerprint {
  const d = resizeGray(gray, side, side, 9, 8);
  const dbits: boolean[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dbits.push(d[y * 9 + x] > d[y * 9 + x + 1]);
  const a = resizeGray(gray, side, side, 8, 8);
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const abits = Array.from(a, v => v > mean);
  const hist = new Array<number>(16).fill(0);
  for (let i = 0; i < side * side; i++) hist[Math.min(15, gray[i] >> 4)]++;
  return { id, width, height, dhash: bitsToHex(dbits), ahash: bitsToHex(abits), hist: hist.map(v => v / (side * side)) };
}

const POP = Array.from({ length: 16 }, (_, n) => n.toString(2).replace(/0/g, '').length);
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

function histSimilarity(a: number[], b: number[]): number {
  // Histogram intersection.
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

/** Placeholders were recompressed, not cropped, so aspect should agree. */
export function aspectPenalty(a: Fingerprint, b: Fingerprint): number {
  const ra = a.width / a.height, rb = b.width / b.height;
  const diff = Math.abs(Math.log(ra / rb));
  return diff < 0.02 ? 0 : diff < 0.08 ? diff * 2 : 0.5 + diff;
}

export function similarity(a: Fingerprint, b: Fingerprint): number {
  const d = 1 - hamming(a.dhash, b.dhash) / 64;
  const m = 1 - hamming(a.ahash, b.ahash) / 64;
  const h = histSimilarity(a.hist, b.hist);
  const raw = 0.5 * d + 0.2 * m + 0.3 * h;
  return Math.max(0, raw - aspectPenalty(a, b));
}

export interface MatchOptions {
  /** Score at or above which a unique best is applied silently. */
  high?: number;
  /** Minimum lead over the runner-up for `high`. */
  margin?: number;
  /** Below this the placeholder is reported as unmatched. */
  floor?: number;
  /** Candidates kept per source. */
  keep?: number;
  /**
   * Original ids in capture order (usually filename order). When the originals
   * and placeholders have the same count, this breaks near ties.
   */
  order?: string[];
}

/**
 * One result per placeholder, in input order. A single original may serve
 * several placeholders; the caller decides what to do with unused originals.
 */
export function matchImages(sources: Fingerprint[], originals: Fingerprint[], options: MatchOptions = {}): ImageMatch[] {
  const { high = 0.86, margin = 0.04, floor = 0.62, keep = 3, order } = options;
  const prior = order && order.length === sources.length ? order : undefined;
  return sources.map((source, index) => {
    const ranked = originals
      .map(o => ({ id: o.id, score: similarity(source, o) + (prior && prior[index] === o.id ? 0.015 : 0) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < floor) return { source: source.id, confidence: best ? best.score : 0, level: 'none' as const, candidates: ranked.slice(0, keep) };
    const lead = second ? best.score - second.score : 1;
    const confidence = Math.max(0, Math.min(1, best.score * 0.7 + Math.min(lead, 0.2) * 1.5));
    const level = best.score >= high && lead >= margin ? ('high' as const) : ('low' as const);
    return { source: source.id, best: best.id, confidence, level, candidates: ranked.slice(0, keep) };
  });
}

/** Originals that no placeholder picked (they still go to the gallery). */
export function unusedOriginals(matches: ImageMatch[], originals: Fingerprint[]): string[] {
  const used = new Set(matches.map(m => m.best).filter(Boolean));
  return originals.map(o => o.id).filter(id => !used.has(id));
}
