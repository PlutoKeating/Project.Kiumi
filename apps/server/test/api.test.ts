import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildApp } from '../src/app.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const dataDir = path.join(root, 'data');
const available = existsSync(path.join(dataDir, 'catalog/index.json'));

let app: Awaited<ReturnType<typeof buildApp>>;
const created: string[] = [];

before(async () => {
  if (!available) return;
  app = await buildApp({ dataDir, logger: false });
  await app.ready();
});

after(async () => {
  for (const id of created) {
    await app.inject({ method: 'DELETE', url: `/api/documents/${id}` });
  }
  await app?.close();
});

test('health and rooms', { skip: !available }, async () => {
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(JSON.parse(health.body).data.ok, true);

  const rooms = await app.inject({ method: 'GET', url: '/api/rooms?house=paper&floor=comp' });
  const payload = JSON.parse(rooms.body);
  assert.ok(payload.data.length >= 20);
  assert.ok(payload.data.some((room: { tag: string }) => room.tag === 'demo:header'));
});

test('list and fetch one template', { skip: !available }, async () => {
  const list = await app.inject({
    method: 'GET',
    url: '/api/templates?room=demo:header&limit=3',
  });
  const payload = JSON.parse(list.body);
  assert.equal(payload.data.length, 3);
  assert.ok(payload.meta.total >= 100);

  const id = payload.data[0].atomTplId as string;
  const one = await app.inject({ method: 'GET', url: `/api/template?id=${encodeURIComponent(id)}` });
  const record = JSON.parse(one.body).data;
  assert.equal(record.atomTplId, id);
  assert.ok(record.matrix);
  assert.ok(record.html.length > 0);
});

test('render a template with slot overrides', { skip: !available }, async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/render',
    payload: {
      tplId: 'demo:header/t-a-01',
      set: { txt1: '<p>一日三餐</p>' },
    },
  });
  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body).data;
  assert.match(data.html, /一日三餐/);
  assert.deepEqual(
    data.issues.filter((issue: { level: string }) => issue.level === 'error'),
    [],
  );
});

test('document lifecycle', { skip: !available }, async () => {
  const createdDoc = await app.inject({
    method: 'POST',
    url: '/api/documents',
    payload: { title: '集成测试' },
  });
  assert.equal(createdDoc.statusCode, 200);
  const doc = JSON.parse(createdDoc.body).data;
  created.push(doc.id);

  const appended = await app.inject({
    method: 'POST',
    url: `/api/documents/${doc.id}/blocks`,
    payload: { atomTplId: 'demo:header/t-a-01', fill: { txt1: '<p>标题A</p>' } },
  });
  assert.equal(JSON.parse(appended.body).data.blocks, 1);

  const fetched = await app.inject({ method: 'GET', url: `/api/documents/${doc.id}` });
  const stored = JSON.parse(fetched.body).data;
  assert.equal(stored.blocks.length, 1);

  const rendered = await app.inject({
    method: 'POST',
    url: '/api/render',
    payload: { document: stored },
  });
  assert.match(JSON.parse(rendered.body).data.html, /标题A/);

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/documents/${doc.id}`,
    payload: { title: '集成测试（改）' },
  });
  assert.equal(JSON.parse(patched.body).data.title, '集成测试（改）');
});

test('rejects unknown template and invalid body', { skip: !available }, async () => {
  const missing = await app.inject({
    method: 'GET',
    url: '/api/template?id=paper-cp:does-not-exist',
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(JSON.parse(missing.body).error.code, 'TEMPLATE_NOT_FOUND');

  const invalid = await app.inject({ method: 'POST', url: '/api/render', payload: {} });
  assert.equal(invalid.statusCode, 400);
  assert.equal(JSON.parse(invalid.body).error.code, 'INVALID_BODY');
});

test('asset path traversal is refused', { skip: !available }, async () => {
  const response = await app.inject({ method: 'GET', url: '/assets/../../etc/passwd' });
  assert.ok([403, 404].includes(response.statusCode), `unexpected ${response.statusCode}`);
});

test('wechat reports unconfigured without credentials', { skip: !available }, async () => {
  const response = await app.inject({ method: 'GET', url: '/api/wechat/config' });
  assert.equal(JSON.parse(response.body).data.configured, false);

  const draft = await app.inject({
    method: 'POST',
    url: '/api/wechat/draft',
    payload: { documentId: 'nope' },
  });
  assert.equal(draft.statusCode, 501);
  assert.equal(JSON.parse(draft.body).error.code, 'WECHAT_NOT_CONFIGURED');
});
