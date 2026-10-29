import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderMatrix, renderDocument, validateHtml } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');

test('hydrates a skeleton slot and applies comp + cell styles', () => {
  const skeletons = {
    'paper-cp:demo/one': '<div tn-bind-cell="txt1" style="color: red"></div>',
  };
  const matrix = [
    {
      _comp: { tplId: 'paper-cp:demo/one', style: { margin: '10px 0' } },
      txt1: { type: 'text', text: '<p>hello</p>', style: { fontSize: '20px' } },
    },
  ];
  const result = renderMatrix(matrix, skeletons);

  assert.match(result.html, /<p>hello<\/p>/);
  assert.match(result.html, /margin: 10px 0/);
  assert.match(result.html, /font-size: 20px/);
  assert.match(result.html, /color: red/);
  assert.equal(result.warnings.length, 0);
});

test('expands a nested group into repeated list items', () => {
  const skeletons = {
    'paper-cp:demo/list': '<ul tn-bind-cell="col1"><li tn-sub-comp-loader></li></ul>',
    'paper-cp:demo/text': '<div tn-bind-cell="txt1"></div>',
  };
  const matrix = [
    {
      _comp: { tplId: 'paper-cp:demo/list' },
      col1: {
        type: 'group',
        items: [
          { _comp: { tplId: 'paper-cp:demo/text' }, txt1: { type: 'text', text: 'a' } },
          { _comp: { tplId: 'paper-cp:demo/text' }, txt1: { type: 'text', text: 'b' } },
        ],
      },
    },
  ];
  const { html } = renderMatrix(matrix, skeletons);
  assert.equal((html.match(/<li class="tn-comp-anim-pin/g) ?? []).length, 2);
  assert.ok(!html.includes('tn-sub-comp-loader'), 'mount point must be consumed');
});

test('is deterministic for identical input', () => {
  const skeletons = { 'paper-cp:demo/one': '<div tn-bind-cell="txt1"></div>' };
  const matrix = [{ _comp: { tplId: 'paper-cp:demo/one' }, txt1: { type: 'text', text: 'x' } }];
  assert.equal(renderMatrix(matrix, skeletons).html, renderMatrix(matrix, skeletons).html);
});

test('validator rejects scripts, relative images and stray zero height', () => {
  const issues = validateHtml(
    [
      '<div style="height: 0">',
      '<script>alert(1)</script>',
      '<img src="./local.png">',
      '</div>',
    ].join(''),
  );
  const rules = issues.map((issue) => issue.rule);
  assert.ok(rules.includes('forbidden-tag'));
  assert.ok(rules.includes('relative-image'));
  assert.ok(rules.includes('zero-height'));
  assert.equal(issues.filter((issue) => issue.rule === 'zero-height' && issue.level === 'error').length, 0);
});

test('native blocks render inline-styled html', () => {
  const doc = {
    version: 1 as const,
    id: 'doc_test',
    title: 'native',
    blocks: [
      { kind: 'native' as const, id: 'b1', node: { kind: 'heading' as const, text: 'Title', level: 2 } },
      { kind: 'native' as const, id: 'b2', node: { kind: 'text' as const, text: 'body' } },
    ],
    meta: { createdAt: '', updatedAt: '' },
  };
  const { html } = renderDocument(doc);
  assert.match(html, /<h2 style="[^"]*font-size: 20px/);
  assert.match(html, /body<\/p>/);
  assert.match(html, /font-size: 16px/);
});

test('real catalog renders without validation errors', { skip: !existsSync(path.join(root, 'data/catalog/index.json')) }, () => {
  const skeletons = JSON.parse(readFileSync(path.join(root, 'data/catalog/pack.json'), 'utf8'));
  // Any locally crawled record: the catalog itself is never distributed.
  const dir = path.join(root, 'data/catalog/templates');
  const sample = readdirSync(dir).find((name) => name.endsWith('.json'));
  assert.ok(sample, 'no local catalog records');
  const record = JSON.parse(readFileSync(path.join(dir, sample), 'utf8'));
  const result = renderMatrix(record.matrix, skeletons);
  assert.ok(result.bytes > 200);
  const errors = validateHtml(result.html).filter((issue) => issue.level === 'error');
  assert.deepEqual(errors, []);
});
