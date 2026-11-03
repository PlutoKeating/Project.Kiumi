import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const KEY = 'local-test-key-never-used-in-production';
const ISSUER = 'https://id.test';
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

// The data service double: the manuscript importer and one style template.
const TEMPLATE = `<section>${[
  `<div><section><div style="font-size:200%"><p><span>正文${' ​'.repeat(12)}</span></p></div></section></div>`,
  `<div><section><div><p><span>正文${' ​'.repeat(100)}</span></p></div></section></div>`,
  '<div><section><div><img src="/assets/x/mat/i/fvId/abc_sz-773899.jpg"></div></section></div>',
].join('')}</section>`;
const FACTS = [
  { i: 0, kind: 'text', text: '测试稿件标题', html: '<p>测试稿件标题</p>', align: 'center', bold: true, size: 24 },
  { i: 1, kind: 'text', text: '这是一段足够长的正文内容，用来保证它不会被误判为标题，并且以句号结尾。', html: '<p>这是一段足够长的正文内容，用来保证它不会被误判为标题，并且以句号结尾。</p>', align: 'left' },
  { i: 2, kind: 'image', text: '', html: '', images: ['word/media/a.jpeg'] },
  { i: 3, kind: 'text', text: '最后一段正文，同样足够长并且以句号结尾。文：甲 图：乙', html: '<p>最后一段正文，同样足够长并且以句号结尾。文：甲 图：乙</p>', align: 'left' },
];

async function setup() {
  const bundled = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const mint = (claims: Record<string, unknown>, ttl = 3600) =>
    new SignJWT({ client_id: 'kiumi-mcp', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + ttl).sign(privateKey);
  const stored: string[] = [];
  const mf = new Miniflare({
    modules: true, script: bundled.outputFiles[0]!.text, compatibilityDate: '2026-01-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], durableObjects: { DOC_HUB: 'DocHub' },
    bindings: { KIUMI_DATA_KEY: KEY, ID_ISSUER_URL: ISSUER, ID_CLIENT_ID: 'kiumi-web' },
    outboundService: async req => new URL(req.url).pathname === '/.well-known/jwks.json' ? Response.json({ keys: [jwk] }) : new Response('no', { status: 404 }),
    serviceBindings: {
      KIUMI_DATA: async req => {
        const path = new URL(req.url).pathname;
        if (path === '/manuscript/import') {
          await req.arrayBuffer();
          return Response.json({ ok: true, data: {
            docName: 'x.docx', facts: FACTS, warnings: [],
            refs: { 'word/media/a.jpeg': { id: 'img_aaaa', key: 'uploads/t/img_aaaa.jpeg', mime: 'image/jpeg', bytes: 10, name: 'photo_1.jpg' } },
            matches: [{ ref: 'word/media/a.jpeg', original: 'photo_1.jpg', level: 'high', confidence: 0.99, candidates: [] }],
            unused: [{ id: 'img_bbbb', key: 'uploads/t/img_bbbb.jpeg', mime: 'image/jpeg', bytes: 10, name: 'spare.jpg' }],
          } });
        }
        if (path.endsWith('shop__paper__test.json')) return Response.json({ atomTplId: 'shop:paper/test', displayName: '测试风格', html: TEMPLATE, matrix: [] });
        if (path === '/catalog/query') return Response.json({ ok: true, data: [{ atomTplId: 'shop:paper/test', displayName: '测试风格' }] });
        if (path.endsWith('.json')) return Response.json({});
        if (req.method === 'PUT') { stored.push(path); return new Response('stored'); }
        return new Response('image');
      },
      ASSETS: async () => new Response('app'),
    },
  });
  const db = await mf.getD1Database('DB');
  for (const file of ['0001_teams.sql', '0002_manuscripts.sql']) {
    const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const cookie = (user: string) => {
    const value = JSON.stringify({ sub: user, name: user, exp: Math.floor(Date.now() / 1000) + 3600 });
    return 'kiumi_session=' + encodeURIComponent(value + '.' + createHmac('sha256', `session:${KEY}`).update(value).digest('base64url'));
  };
  return { mf, db, mint, cookie, stored };
}

test('remote MCP: OAuth discovery, bearer auth, import, edit, lint, preview and live updates', async () => {
  const { mf, db, mint, cookie } = await setup();
  try {
    const url = 'https://test.invalid';
    // Discovery and the 401 challenge.
    const prm = await (await mf.dispatchFetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json() as any;
    assert.equal(prm.resource, `${url}/mcp`);
    assert.deepEqual(prm.authorization_servers, [ISSUER]);
    const denied = await mf.dispatchFetch(`${url}/mcp`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate')!, /resource_metadata="https:\/\/test\.invalid\/\.well-known\/oauth-protected-resource\/mcp"/);
    const wrongClient = await mint({ sub: 'alice', client_id: 'someone-else' });
    assert.equal((await mf.dispatchFetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${wrongClient}` }, body: '{}' })).status, 401);
    const expired = await mint({ sub: 'alice' }, -10);
    assert.equal((await mf.dispatchFetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${expired}` }, body: '{}' })).status, 401);
    const wrongAudience = await mint({ sub: 'alice', aud: 'https://elsewhere.example/mcp' });
    assert.equal((await mf.dispatchFetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${wrongAudience}` }, body: '{}' })).status, 401);

    const token = await mint({ sub: 'alice', name: 'Alice' });
    let id = 0;
    const rpc = async (method: string, params?: unknown, bearer = token) => {
      const response = await mf.dispatchFetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      return { status: response.status, body: await response.json() as any };
    };
    const call = async (name: string, args: unknown = {}) => {
      const { body } = await rpc('tools/call', { name, arguments: args });
      const out = body.result;
      return { error: out.isError ? JSON.parse(out.content[0].text) : null, data: out.isError ? null : JSON.parse(out.content[0].text) };
    };

    const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.body.result.protocolVersion, '2025-06-18');
    const names = (await rpc('tools/list')).body.result.tools.map((t: any) => t.name);
    for (const n of ['kiumi_begin_import', 'kiumi_edit_document', 'kiumi_lint', 'kiumi_preview_link']) assert.ok(names.includes(n), n);

    // No team yet.
    assert.equal((await call('kiumi_list_documents')).error.code, 'TEAM_REQUIRED');
    const aliceTeam = await mf.dispatchFetch(`${url}/api/teams`, { method: 'POST', headers: { cookie: cookie('alice'), 'content-type': 'application/json' }, body: JSON.stringify({ name: '编辑组' }) });
    const teamId = ((await aliceTeam.json()) as any).data.id as string;

    const created = (await call('kiumi_create_document', { title: '待导入' })).data;
    const docId = created.documentId as string;

    // Open an editor socket (browser side) before the Agent edits.
    const socketResponse = await mf.dispatchFetch(`${url}/api/documents/${docId}/live?client=browser-1`, { headers: { upgrade: 'websocket', cookie: cookie('alice'), 'x-team-id': teamId } });
    assert.equal(socketResponse.status, 101);
    const socket = socketResponse.webSocket!;
    socket.accept();
    const messages: any[] = [];
    socket.addEventListener('message', event => messages.push(JSON.parse(String(event.data))));
    // Another site cannot open the socket with the user's cookie; strangers cannot listen in.
    const crossSite = await mf.dispatchFetch(`${url}/api/documents/${docId}/live`, { headers: { upgrade: 'websocket', cookie: cookie('alice'), 'x-team-id': teamId, origin: 'https://evil.example' } });
    assert.equal(crossSite.status, 403);
    const stranger = await mf.dispatchFetch(`${url}/api/documents/${docId}/live`, { headers: { upgrade: 'websocket', cookie: cookie('mallory'), 'x-team-id': teamId } });
    assert.ok([403, 401].includes(stranger.status));

    assert.equal((await call('kiumi_describe_style', { atomTplId: 'shop:paper/test' })).data.photo, 1);
    assert.equal((await call('kiumi_search_styles', { q: '测试' })).data[0].atomTplId, 'shop:paper/test');

    // Presigned import: parse, match, pour into the style, write the document.
    const begin = (await call('kiumi_begin_import', { documentId: docId, style: 'shop:paper/test' })).data;
    assert.match(begin.uploadUrl, /\/api\/import\/manuscript\?token=/);
    const tampered = await mf.dispatchFetch(begin.uploadUrl.replace('https://test.invalid', url) + 'x', { method: 'POST', body: new Uint8Array(32) });
    assert.equal(tampered.status, 403);
    const imported = await mf.dispatchFetch(begin.uploadUrl, { method: 'POST', body: new Uint8Array(64) });
    const importedBody = (await imported.json()) as any;
    assert.equal(imported.status, 200, JSON.stringify(importedBody));
    const report = importedBody.data;
    assert.equal(report.title, '测试稿件标题');
    assert.equal(report.images.matchedToOriginals, 1);
    assert.deepEqual(report.images.unusedOriginalsInGallery, ['spare.jpg']);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM uploads').first<{ n: number }>())!.n, 2);

    const outline = (await call('kiumi_get_document', { documentId: docId })).data;
    assert.equal(outline.title, '测试稿件标题');
    assert.equal(outline.blocks.length, 1);
    assert.ok(outline.rev >= 2);
    const full = (await call('kiumi_get_document', { documentId: docId, view: 'full' })).data;
    assert.match(full.blocks[0].html, /\/uploads\/img_aaaa/);
    assert.equal(full.meta.cover, '/uploads/img_aaaa');
    assert.ok(!full.blocks[0].html.includes('​'));

    // Live: the Agent's change reached the open editor.
    await new Promise(r => setTimeout(r, 100));
    const live = messages.find(m => m.type === 'changed' && m.by === 'agent');
    assert.ok(live, 'editor must be notified of the Agent edit');
    assert.equal(live.rev, outline.rev);

    // Fine edits by block id, and text replacement that leaves markup alone.
    const blockId = outline.blocks[0].id;
    const replaced = (await call('kiumi_replace_text', { documentId: docId, find: '最后一段正文', replace: '结尾段落' })).data;
    assert.equal(replaced.replaced, 1);
    assert.match((await call('kiumi_get_document', { documentId: docId, view: 'block', blockId })).data.block.html, /结尾段落/);
    const edited = await call('kiumi_edit_document', { documentId: docId, ops: [{ op: 'title', title: '改过的标题' }, { op: 'meta', meta: { digest: '摘要' } }] });
    assert.ok(edited.data.rev > replaced.rev);
    assert.equal((await call('kiumi_edit_document', { documentId: docId, ops: [{ op: 'remove', ids: ['nope'] }] })).error.code, 'OPS_FAILED');
    assert.equal((await call('kiumi_edit_document', { documentId: docId, ops: 'bad' })).error.code, 'INVALID_OPS');

    // Re-style and structure correction work from the stored manuscript.
    const manuscript = (await call('kiumi_get_manuscript', { documentId: docId })).data;
    assert.equal(manuscript.style, 'shop:paper/test');
    // The Agent plans the layout itself: it reads the prompt and submits a plan.
    const described = (await call('kiumi_describe_style', { atomTplId: 'shop:paper/test', documentId: docId })).data;
    assert.match(described.planPrompt, /只输出 JSON/);
    assert.match(described.planPrompt, /\nf0 图片/);
    assert.equal((await call('kiumi_apply_style', { documentId: docId, style: 'shop:paper/test', plan: 'nonsense' })).error.code, 'INVALID_PLAN');
    const units = [...described.planPrompt.matchAll(/^u(\d+) (\w+)/gm)].map(m => ({ u: Number(m[1]), kind: m[2] }));
    const textUnit = units.find(x => x.kind === 'text' || x.kind === 'mixed')!;
    const planned = (await call('kiumi_apply_style', { documentId: docId, style: 'shop:paper/test', plan: { entries: [{ u: textUnit.u, t: { 0: ['p0'] } }] } })).data;
    assert.ok(planned.rev > edited.data.rev);
    const plannedDoc = (await call('kiumi_get_document', { documentId: docId, view: 'full' })).data;
    assert.match(plannedDoc.blocks[0].html, /\/uploads\/img_aaaa/, 'pieces the plan left out are still set');
    const unstyled = (await call('kiumi_apply_style', { documentId: docId, style: null })).data;
    assert.ok(unstyled.rev > edited.data.rev);
    const plain = (await call('kiumi_get_document', { documentId: docId })).data;
    assert.ok(plain.blocks.length > 1, 'plain typesetting produces several blocks');

    // Review: lint and a signed preview link readable without login.
    const lint = (await call('kiumi_lint', { documentId: docId })).data;
    assert.ok(Array.isArray(lint.style));
    const link = (await call('kiumi_preview_link', { documentId: docId })).data;
    const page = await mf.dispatchFetch(link.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy')!, /default-src 'none'/);
    assert.match(await page.text(), /测试稿件标题|改过的标题/);
    assert.equal((await mf.dispatchFetch(link.url.replace(docId, 'doc_other'))).status, 403);

    // Another user cannot reach the document at all.
    const mallory = await mint({ sub: 'mallory' });
    const forbidden = await rpc('tools/call', { name: 'kiumi_get_document', arguments: { documentId: docId } }, mallory);
    assert.equal(forbidden.body.result.isError, true);

    // Revision guard for the web editor: a stale save is refused, a fresh one passes.
    const patch = (baseRev: number) => mf.dispatchFetch(`${url}/api/documents/${docId}`, { method: 'PATCH', headers: { cookie: cookie('alice'), 'x-team-id': teamId, 'content-type': 'application/json' }, body: JSON.stringify({ title: '网页保存', baseRev }) });
    assert.equal((await patch(1)).status, 409);
    const currentRev = (await call('kiumi_get_document', { documentId: docId })).data.rev;
    const saved = await patch(currentRev);
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as any).data.meta.rev, currentRev + 1);

    // Team rules: members read, only the owner writes.
    assert.equal((await call('kiumi_typeset_rules')).data.bodySize, 14);
    assert.equal((await call('kiumi_typeset_rules', { set: { bodySize: 15, textColor: '#111111' } })).data.bodySize, 15);
    assert.ok(teamId);
    socket.close();
  } finally { await mf.dispose(); }
});
