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

  const rooms = await app.inject({ method: 'GET', url: '/api/rooms' });
  const payload = JSON.parse(rooms.body);
  assert.ok(payload.data.length >= 5);
  for (const room of payload.data) {
    assert.equal(typeof room.tag, 'string');
    assert.equal(typeof room.count, 'number');
  }
  assert.ok(payload.data.some((room: { tag: string }) => room.tag === 'paper-cp:header'));
});

test('list and fetch one template', { skip: !available }, async () => {
  const list = await app.inject({
    method: 'GET',
    url: '/api/templates?room=paper-cp:header&limit=3',
  });
  const payload = JSON.parse(list.body);
  assert.equal(payload.data.length, 3);
  assert.ok(payload.meta.total >= 3);

  const id = payload.data[0].atomTplId as string;
  const one = await app.inject({ method: 'GET', url: `/api/template?id=${encodeURIComponent(id)}` });
  const record = JSON.parse(one.body).data;
  assert.equal(record.atomTplId, id);
  assert.ok(record.matrix);
  assert.ok(record.html.length > 0);
});

test('render a template with slot overrides', { skip: !available }, async () => {
  // SVG templates synthesise markup upstream, so their slot overrides cannot be
  // applied to the recorded copy; pick a plain text template for this check.
  const list = await app.inject({
    method: 'GET',
    url: '/api/templates?room=paper-cp:header&hasSvg=false&limit=5',
  });
  const tplId = JSON.parse(list.body).data[0].atomTplId as string;
  const slots = await app.inject({ method: 'GET', url: `/api/slots?id=${encodeURIComponent(tplId)}` });
  const names = JSON.parse(slots.body).data as string[];

  const response = await app.inject({
    method: 'POST',
    url: '/api/render',
    payload: { tplId },
  });
  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body).data;
  assert.ok(data.html.length > 0);
  assert.deepEqual(
    data.issues.filter((issue: { level: string }) => issue.level === 'error'),
    [],
  );

  const textSlot = names.find((name) => name.startsWith('txt'));
  if (textSlot) {
    const filled = await app.inject({
      method: 'POST',
      url: '/api/fill',
      payload: { tplId, set: { [textSlot]: '<p>一日三餐</p>' } },
    });
    assert.equal(filled.statusCode, 200);
    const after = JSON.parse(filled.body).data.html as string;
    const before = JSON.parse(response.body).data.html as string;
    // Composite templates may nest the edited slot, so compare the result
    // instead of matching one exact string.
    assert.notEqual(after, before);
  }
});

test('document lifecycle', { skip: !available }, async () => {
  const list = await app.inject({ method: 'GET', url: '/api/templates?room=paper-cp:header&limit=1' });
  const atomTplId = JSON.parse(list.body).data[0].atomTplId as string;

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
    payload: { atomTplId, fill: {} },
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
  assert.ok(JSON.parse(rendered.body).data.html.length > 0);

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
