import assert from 'node:assert/strict';
import { test } from 'node:test';
import { THUMB, fingerprint, matchImages, unusedOriginals } from '../src/index.ts';

// Deterministic synthetic "photos": smooth scenes built from a seed.
function scene(seed: number, noise = 0): Uint8Array {
  const g = new Uint8Array(THUMB * THUMB);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const blobs = Array.from({ length: 5 }, () => ({ x: rnd() * THUMB, y: rnd() * THUMB, r: 4 + rnd() * 9, v: rnd() * 255 }));
  for (let y = 0; y < THUMB; y++) for (let x = 0; x < THUMB; x++) {
    let v = 90 + 40 * Math.sin((x + seed) / 6) * Math.cos((y - seed) / 7);
    for (const b of blobs) { const d = Math.hypot(x - b.x, y - b.y); if (d < b.r) v = v * 0.3 + b.v * 0.7; }
    g[y * THUMB + x] = Math.max(0, Math.min(255, v + (noise ? (rnd() - 0.5) * noise : 0)));
  }
  return g;
}

test('recompressed placeholders find their originals', () => {
  const originals = [1, 2, 3, 4].map(n => fingerprint(`orig-${n}.jpg`, scene(n), 4000, 3000));
  // Placeholders: same scenes, noisier, smaller pixel size, same aspect.
  const sources = [3, 1, 4].map((n, i) => fingerprint(`ph-${i}`, scene(n, 18), 900, 675));
  const m = matchImages(sources, originals);
  assert.deepEqual(m.map(x => x.best), ['orig-3.jpg', 'orig-1.jpg', 'orig-4.jpg']);
  assert.ok(m.every(x => x.level !== 'none'));
  assert.deepEqual(unusedOriginals(m, originals), ['orig-2.jpg']);
});

test('one original may serve two placeholders and unknown images are reported', () => {
  const originals = [fingerprint('a.jpg', scene(7), 4000, 3000)];
  const sources = [fingerprint('p1', scene(7, 10), 900, 675), fingerprint('p2', scene(7, 10), 900, 675), fingerprint('p3', scene(50), 600, 900)];
  const m = matchImages(sources, originals);
  assert.equal(m[0].best, 'a.jpg');
  assert.equal(m[1].best, 'a.jpg');
  assert.equal(m[2].level, 'none');
});
