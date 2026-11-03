import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const KEY = 'local-test-key-never-used-in-production';
const CATALOG = 'https://catalog.test/api.json';

/** Upstream doubles: a models.dev-shaped catalog and two model gateways. */
const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
let chatFails = true;
async function upstream(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.href === CATALOG) return Response.json({
    acme: { id: 'acme', name: 'Acme AI', npm: '@ai-sdk/openai-compatible', api: 'https://gw.acme.test/v1', doc: 'https://acme.test/docs', models: { 'acme-large': { id: 'acme-large', name: 'Acme Large', limit: { context: 128000, output: 8000 }, cost: { input: 1, output: 2 }, modalities: { input: ['text', 'image'] } } } },
    claudeish: { id: 'claudeish', name: 'Claudeish', npm: '@ai-sdk/anthropic', models: { 'c-1': { id: 'c-1', name: 'C 1' } } },
    weird: { id: 'weird', name: 'Weird', npm: '@ai-sdk/amazon-bedrock', models: {} },
  });
  const body = req.method === 'POST' ? await req.json() : null;
  calls.push({ url: url.href, headers: Object.fromEntries(req.headers), body });
  if (url.href === 'https://gw.acme.test/v1/chat/completions') {
    if (chatFails) return new Response('overloaded', { status: 503 });
    return Response.json({ choices: [{ message: { content: '{"entries":[{"u":0,"t":{"0":["T"]}}]}' } }] });
  }
  if (url.href === 'https://claude.test/v1/messages') return Response.json({ content: [{ type: 'text', text: '{"entries":[{"u":1,"t":{"0":["p0"]}}]}' }], stop_reason: 'end_turn' });
  return new Response('not found', { status: 404 });
}

async function setup(bindings: Record<string, string>) {
  const bundled = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const mf = new Miniflare({
    modules: true, script: bundled.outputFiles[0]!.text, compatibilityDate: '2026-01-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], durableObjects: { DOC_HUB: 'DocHub' },
    bindings: { KIUMI_DATA_KEY: KEY, ID_ISSUER_URL: 'https://id.test', ID_CLIENT_ID: 'kiumi-web', MODEL_CATALOG_URL: CATALOG, ...bindings },
    outboundService: upstream,
    serviceBindings: { ASSETS: async () => new Response('app'), KIUMI_DATA: async () => Response.json({}) },
  });
  const db = await mf.getD1Database('DB');
  for (const file of ['0001_teams.sql', '0002_manuscripts.sql', '0003_settings.sql']) {
    const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const cookie = (user: string) => {
    const value = JSON.stringify({ sub: user, name: user, exp: Math.floor(Date.now() / 1000) + 3600 });
    return 'kiumi_session=' + encodeURIComponent(value + '.' + createHmac('sha256', `session:${KEY}`).update(value).digest('base64url'));
  };
  const api = async (path: string, user: string, init: { method?: string; body?: unknown; team?: string } = {}) => {
    const response = await mf.dispatchFetch(`https://kiumi.test${path}`, {
      method: init.method ?? 'GET',
      headers: { cookie: cookie(user), origin: 'https://kiumi.test', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.team ? { 'x-team-id': init.team } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: response.status, body: await response.json() as any };
  };
  return { mf, db, api };
}

test('admin panel configures model providers live, with catalog, encrypted keys and fallback', async () => {
  const { mf, db, api } = await setup({ KIUMI_ADMIN_SUBS: 'root, Boss@Example.com' });
  try {
    // Only listed admins, only browser sessions.
    assert.equal((await api('/api/admin/llm', 'mallory')).status, 403);
    assert.equal((await api('/api/me', 'root')).body.data.admin, true);
    assert.equal((await api('/api/me', 'mallory')).body.data.admin, false);
    const bearer = await mf.dispatchFetch('https://kiumi.test/api/admin/llm', { headers: { authorization: 'Bearer x' } });
    assert.equal(bearer.status, 403);

    const empty = (await api('/api/admin/llm', 'root')).body.data;
    assert.equal(empty.source, 'none');
    assert.equal(empty.version, 0);
    assert.equal(empty.defaultCatalogUrl, CATALOG);

    // Catalog: protocol inferred from the SDK package, Base URL only from the catalog.
    const catalog = (await api('/api/admin/catalog?refresh=1', 'root')).body.data;
    assert.equal(catalog.error, null);
    const acme = catalog.providers.find((p: any) => p.id === 'acme');
    assert.deepEqual([acme.protocol, acme.baseUrl, acme.modelCount], ['openai-chat', 'https://gw.acme.test/v1', 1]);
    const claudeish = catalog.providers.find((p: any) => p.id === 'claudeish');
    assert.deepEqual([claudeish.protocol, claudeish.baseUrl], ['anthropic-messages', null]);
    assert.equal(catalog.providers.find((p: any) => p.id === 'weird').protocol, null);
    const models = (await api('/api/admin/catalog/models?provider=acme', 'root')).body.data.models;
    assert.deepEqual([models[0].id, models[0].context, models[0].images], ['acme-large', 128000, true]);

    // Save two providers; keys are write-only.
    const draft = {
      version: 0,
      providers: [
        { id: 'acme', name: 'Acme', catalogId: 'acme', protocol: 'openai-chat', baseUrl: 'https://gw.acme.test/v1', enabled: true, headers: { 'x-team': 'kiumi' }, keys: [{ label: '主', apiKey: 'sk-acme-0001' }], models: [{ id: 'acme-large', enabled: true, order: 0 }] },
        { id: 'claude', name: 'Claude 网关', catalogId: 'claudeish', protocol: 'anthropic-messages', baseUrl: 'https://claude.test/v1', enabled: true, headers: {}, keys: [{ label: '', apiKey: 'sk-claude-9999' }], models: [{ id: 'c-1', enabled: true, order: 1 }] },
      ],
      purposes: { plan: { targets: [], maxTokens: 3000, timeoutMs: 20000 } },
    };
    assert.equal((await api('/api/admin/llm', 'mallory', { method: 'PUT', body: draft })).status, 403);
    const saved = await api('/api/admin/llm', 'boss@example.com', { method: 'PUT', body: draft });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.version, 1);
    assert.equal(saved.body.data.source, 'panel');
    assert.equal(saved.body.data.updatedBy, 'boss@example.com');
    assert.equal(saved.body.data.providers[0].keys[0].masked, '••••0001');
    assert.ok(!JSON.stringify(saved.body).includes('sk-acme'), 'keys never come back');
    const raw = (await db.prepare("SELECT value FROM settings WHERE key='llm-config'").first<{ value: string }>())!.value;
    assert.ok(!raw.includes('sk-acme') && !raw.includes('sk-claude'), 'keys are stored encrypted');
    assert.deepEqual(saved.body.data.targets.map((t: any) => [t.id, t.callable]), [['acme/acme-large', true], ['claude/c-1', true]]);

    // Optimistic lock and validation.
    assert.equal((await api('/api/admin/llm', 'root', { method: 'PUT', body: draft })).body.error.code, 'VERSION_CONFLICT');
    assert.equal((await api('/api/admin/llm', 'root', { method: 'PUT', body: { ...draft, version: 1, providers: [{ ...draft.providers[0], baseUrl: 'http://gw.acme.test' }] } })).status, 400);

    // The web planner uses the chain: Acme fails, Claude answers with the decrypted key.
    const team = (await api('/api/teams', 'root', { method: 'POST', body: { name: '团队' } })).body.data;
    const teamId = team.id ?? team.team?.id;
    calls.length = 0;
    const planned = await api('/api/manuscript/plan', 'root', { method: 'POST', team: teamId, body: { prompt: '排版' } });
    assert.equal(planned.status, 200, JSON.stringify(planned.body));
    assert.deepEqual(planned.body.data.entries, [{ u: 1, t: { 0: ['p0'] } }]);
    assert.equal(calls[0].headers.authorization, 'Bearer sk-acme-0001');
    assert.equal(calls[0].headers['x-team'], 'kiumi');
    assert.equal(calls[0].body.model, 'acme-large');
    assert.equal(calls[0].body.max_tokens, 3000);
    assert.equal(calls[1].headers['x-api-key'], 'sk-claude-9999');
    assert.equal(calls[1].body.model, 'c-1');

    // Hot change: keep the existing key by id, reorder, and route planning to Acme only.
    const current = (await api('/api/admin/llm', 'root')).body.data;
    const keep = current.providers.map((p: any) => ({ ...p, keys: p.keys.map((k: any) => ({ id: k.id, label: k.label, enabled: k.enabled })) }));
    keep[1].models[0].order = -1;
    const next = await api('/api/admin/llm', 'root', { method: 'PUT', body: { version: 1, providers: keep, purposes: { plan: { targets: ['acme/acme-large'], maxTokens: 2000, timeoutMs: 20000 } } } });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.equal(next.body.data.targets[0].id, 'claude/c-1', 'global order renumbered');
    chatFails = false;
    calls.length = 0;
    const second = await api('/api/manuscript/plan', 'root', { method: 'POST', team: teamId, body: { prompt: '排版' } });
    assert.deepEqual(second.body.data.entries, [{ u: 0, t: { 0: ['T'] } }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.max_tokens, 2000);
    assert.equal(calls[0].headers.authorization, 'Bearer sk-acme-0001', 'kept key still decrypts');

    // Connectivity check against a saved key and against an unsaved one.
    const ok = (await api('/api/admin/llm/test', 'root', { method: 'POST', body: { provider: { id: 'claude', protocol: 'anthropic-messages', baseUrl: 'https://claude.test/v1' }, model: 'c-1' } })).body.data;
    assert.equal(ok.ok, true);
    const nope = (await api('/api/admin/llm/test', 'root', { method: 'POST', body: { provider: { id: 'new', protocol: 'openai-chat', baseUrl: 'https://down.test/v1' }, model: 'x', apiKey: 'sk-temporary' } })).body.data;
    assert.equal(nope.ok, false);
    assert.match(nope.error, /HTTP 404/);
  } finally {
    await mf.dispose();
  }
});

test('without panel providers the legacy LLM_* variables still work, and no admin means no panel', async () => {
  const { mf, api } = await setup({ LLM_API_URL: 'https://claude.test/v1', LLM_API_KEY: 'sk-env-1234', LLM_MODEL: 'c-1', LLM_PROTOCOL: 'anthropic-messages' });
  try {
    const denied = await api('/api/admin/llm', 'root');
    assert.equal(denied.status, 403);
    assert.match(denied.body.error.message, /KIUMI_ADMIN_SUBS/);
    const team = (await api('/api/teams', 'root', { method: 'POST', body: { name: '团队' } })).body.data;
    calls.length = 0;
    const planned = await api('/api/manuscript/plan', 'root', { method: 'POST', team: team.id ?? team.team?.id, body: { prompt: '排版' } });
    assert.equal(planned.status, 200, JSON.stringify(planned.body));
    assert.equal(calls[0].headers['x-api-key'], 'sk-env-1234');
  } finally {
    await mf.dispose();
  }
});
