import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('vendored core modules match packages/core/src', () => {
  const script = path.resolve(import.meta.dirname, '../../../scripts/sync-ecs-core.mjs');
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
