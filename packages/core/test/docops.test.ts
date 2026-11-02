import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, validateOps, type KiumiDocument } from '../src/index.ts';

const blk = (id: string, html = id) => ({ kind: 'library' as const, id, tplId: 'imported:段落', matrix: [], html });
const doc = (): KiumiDocument => ({ version: 1, id: 'd', title: 't', blocks: [blk('a'), blk('b'), blk('c')], meta: { createdAt: '', updatedAt: '' } });

test('ops address blocks by id and report misses', () => {
  const r = applyOps(doc(), [
    { op: 'insert', blocks: [blk('x')], at: { after: 'a' } },
    { op: 'move', id: 'c', to: 0 },
    { op: 'html', id: 'b', html: '<p>new</p>' },
    { op: 'remove', ids: ['a', 'zzz'] },
    { op: 'title', title: ' 新标题 ' },
    { op: 'meta', meta: { digest: '摘要' } },
  ]);
  assert.deepEqual(r.doc.blocks.map(b => b.id), ['c', 'x', 'b']);
  assert.equal((r.doc.blocks[2] as any).html, '<p>new</p>');
  assert.equal(r.doc.title, '新标题');
  assert.equal(r.doc.meta.digest, '摘要');
  assert.equal(r.errors.length, 1);
});

test('set replaces everything, and network ops are validated', () => {
  assert.deepEqual(applyOps(doc(), [{ op: 'set', blocks: [blk('n')], title: 'x' }]).doc.blocks.map(b => b.id), ['n']);
  assert.throws(() => validateOps([{ op: 'insert', blocks: [{ nope: 1 }] }]));
  assert.throws(() => validateOps('x'));
  assert.equal(validateOps([{ op: 'title', title: 'a' }]).length, 1);
});
