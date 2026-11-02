#!/usr/bin/env node
// The data service runs from deploy/ecs-data alone, so the few pure core modules it needs
// are vendored next to it. `pnpm test` fails when the copy drifts from packages/core/src.
//   node scripts/sync-ecs-core.mjs         copy
//   node scripts/sync-ecs-core.mjs --check verify only
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
export const FILES = ['manuscript.ts', 'docxfacts.ts', 'imagematch.ts'];
const header = f => `// Vendored from packages/core/src/${f}. Do not edit: run \`pnpm sync:ecs-core\`.\n`;
const check = process.argv.includes('--check');
let drift = 0;
for (const file of FILES) {
  const source = header(file) + readFileSync(path.join(root, 'packages/core/src', file), 'utf8');
  const target = path.join(root, 'deploy/ecs-data/core', file);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current === source) continue;
  drift++;
  if (!check) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, source); console.log(`updated ${path.relative(root, target)}`); }
}
if (check && drift) { console.error(`deploy/ecs-data/core is out of date (${drift} file(s)); run pnpm sync:ecs-core`); process.exit(1); }
