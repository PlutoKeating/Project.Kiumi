import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(import.meta.dirname, '../../..');

test('mcp server exposes tools and renders a template end to end', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'packages/mcp/src/index.ts')],
    env: { ...process.env, KIUMI_DATA_DIR: path.join(root, 'data') },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'kiumi-smoke', version: '0.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  assert.ok(names.includes('kiumi_list_rooms'), 'list_rooms tool missing');
  assert.ok(names.includes('kiumi_render_document'), 'render_document tool missing');
  assert.ok(names.length >= 12, `expected at least 12 tools, got ${names.length}`);

  const rooms = await client.callTool({ name: 'kiumi_list_rooms', arguments: {} });
  const roomText = String((rooms.content as { text: string }[])[0]?.text ?? '');
  assert.ok(roomText.includes('paper-cp:header'), 'rooms payload missing header room');

  const created = await client.callTool({
    name: 'kiumi_create_document',
    arguments: { title: 'smoke' },
  });
  const doc = JSON.parse(String((created.content as { text: string }[])[0]?.text));
  assert.ok(doc.id, 'document id missing');

  const inserted = await client.callTool({
    name: 'kiumi_insert_template',
    arguments: {
      documentId: doc.id,
      atomTplId: 'demo:header/t-a-01',
      fill: { txt1: '<p>一日三餐</p>' },
    },
  });
  assert.notEqual(inserted.isError, true, 'insert failed');

  const rendered = await client.callTool({
    name: 'kiumi_render_document',
    arguments: { documentId: doc.id },
  });
  const payload = JSON.parse(String((rendered.content as { text: string }[])[0]?.text));
  assert.ok(payload.html.includes('一日三餐'), 'rendered html missing text');
  assert.equal(payload.issues.filter((i: { level: string }) => i.level === 'error').length, 0);

  await client.close();
});
