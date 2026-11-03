import { useEffect, useMemo, useRef, useState } from 'react';
import { request, fetchSession, loginUrl, type SessionState } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { Segmented, Select } from '../components/ui.tsx';
import { Grip, SortableList } from './Sortable.tsx';

/**
 * Site admin: model providers, Keys, call order and per-purpose settings.
 * Everything is edited as one draft and saved against the server version;
 * the Worker reads the saved document on every model call, so a save takes
 * effect on the next import with no deploy.
 */

type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
type Purpose = 'annotate' | 'plan';
const PROTOCOL_OPTIONS: { value: Protocol; label: string }[] = [
  { value: 'openai-chat', label: 'OpenAI 兼容 · Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI · Responses' },
  { value: 'anthropic-messages', label: 'Anthropic · Messages' },
  { value: 'google-generative-ai', label: 'Google · Generative AI' },
];
const PURPOSE_LABEL: Record<Purpose, { title: string; detail: string }> = {
  annotate: { title: '结构识别', detail: '导入时复核每段是标题、小标题、正文还是署名' },
  plan: { title: '风格编排', detail: '决定稿件每部分放进模板的哪个单元，并为小标题条拟写短标题' },
};
const REASON: Record<string, string> = { provider_disabled: '提供商已停用', model_disabled: '模型已停用', no_key: '没有可用 Key' };

interface DraftKey { id?: string; label: string; enabled: boolean; masked?: string; addedAt?: string; apiKey?: string }
interface DraftModel { id: string; enabled: boolean; order: number }
interface DraftProvider { id: string; name: string; catalogId: string | null; protocol: Protocol; baseUrl: string; enabled: boolean; headers: Record<string, string>; keys: DraftKey[]; models: DraftModel[]; isNew?: boolean }
interface PurposeConfig { targets: string[]; maxTokens: number; timeoutMs: number }
interface ConfigView {
  version: number; updatedAt?: string; updatedBy?: string; source: 'panel' | 'env' | 'none';
  envFallback: { baseUrl: string; model: string; protocol: Protocol } | null;
  catalogUrl: string; defaultCatalogUrl: string;
  purposes: Record<Purpose, PurposeConfig>;
  providers: DraftProvider[];
  targets: Array<{ id: string; callable: boolean; reason?: string }>;
}
interface CatalogProvider { id: string; name: string; doc: string | null; baseUrl: string | null; npm: string; protocol: Protocol | null; modelCount: number }
interface CatalogModel { id: string; name: string; status: string | null; updated: string | null; released: string | null; context: number | null; output: number | null; costIn: number | null; costOut: number | null; reasoning: boolean; images: boolean }
interface CatalogView { source: string | null; fetchedAt: string | null; error: string | null; providers: CatalogProvider[] }
interface Draft { providers: DraftProvider[]; purposes: Record<Purpose, PurposeConfig>; catalogUrl: string }

const snapshot = (d: Draft) => JSON.stringify(d);
const fromView = (v: ConfigView): Draft => ({ providers: v.providers.map(p => ({ ...p, headers: p.headers ?? {} })), purposes: v.purposes, catalogUrl: v.catalogUrl });
const fmtTokens = (n: number | null) => (n == null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'provider';

export function AdminApp() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [view, setView] = useState<ConfigView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [tab, setTab] = useState<'providers' | 'order' | 'settings'>('providers');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = async () => {
    const v = await request<ConfigView>('/api/admin/llm');
    setView(v); setDraft(fromView(v));
  };
  const loadCatalog = async (refresh = false) => {
    try { setCatalog(await request<CatalogView>(`/api/admin/catalog${refresh ? '?refresh=1' : ''}`)); }
    catch (error) { setCatalog({ source: null, fetchedAt: null, error: (error as Error).message, providers: [] }); }
  };
  useEffect(() => {
    void fetchSession().then(s => {
      setSession(s);
      if (s.admin) { load().catch(error => setLoadError((error as Error).message)); void loadCatalog(); }
    });
  }, []);

  const dirty = !!view && !!draft && snapshot(draft) !== snapshot(fromView(view));
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!session) return <div className="admin-page workbench"><p className="admin-empty">正在读取登录状态…</p></div>;
  if (!session.user) return <div className="admin-page workbench"><div className="admin-empty"><h1>模型配置</h1><p>需要先登录站点管理员账号。</p><a className="btn btn-candy" href={loginUrl('/admin')}>登录</a></div></div>;
  if (!session.admin) return <div className="admin-page workbench"><div className="admin-empty"><h1>模型配置</h1><p>当前账号不是站点管理员。管理员名单由部署变量 <code>KIUMI_ADMIN_SUBS</code> 设置（账号 sub 或邮箱，逗号分隔）。</p><a className="btn btn-plain" href="/">返回工作台</a></div></div>;
  if (loadError) return <div className="admin-page workbench"><div className="admin-empty"><h1>模型配置</h1><p className="field-error">{loadError}</p></div></div>;
  if (!view || !draft) return <div className="admin-page workbench"><p className="admin-empty">正在读取配置…</p></div>;

  const update = (fn: (d: Draft) => Draft) => setDraft(d => (d ? fn(structuredClone(d)) : d));
  const updateProvider = (index: number, fn: (p: DraftProvider) => void) => update(d => { fn(d.providers[index]); return d; });
  const nextOrder = () => Math.max(-1, ...draft.providers.flatMap(p => p.models.map(m => m.order))) + 1;

  const save = async () => {
    setBusy(true); setNotice(null);
    try {
      const body = {
        version: view.version,
        catalogUrl: draft.catalogUrl,
        purposes: draft.purposes,
        providers: draft.providers.map(({ isNew: _n, keys, ...p }) => ({ ...p, keys: keys.map(k => (k.apiKey ? { label: k.label, enabled: k.enabled, apiKey: k.apiKey } : { id: k.id, label: k.label, enabled: k.enabled })) })),
      };
      const next = await request<ConfigView>('/api/admin/llm', { method: 'PUT', body: JSON.stringify(body) });
      setView(next); setDraft(fromView(next));
      setNotice({ tone: 'ok', text: `已保存（版本 ${next.version}），下一次导入立即生效。` });
      if (draft.catalogUrl !== view.catalogUrl) void loadCatalog(true);
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <div className="admin-page workbench">
      <header className="admin-bar">
        <a className="admin-brand" href="/"><Icon name="arrow" size={16} />工作台</a>
        <h1>模型配置</h1>
        <span className="admin-state" data-dirty={dirty}>{dirty ? '有未保存的更改' : view.version ? `已同步 · 版本 ${view.version}${view.updatedBy ? ` · ${view.updatedBy}` : ''}` : '尚未保存过'}</span>
        <div className="admin-bar-actions">
          <button type="button" className="btn btn-plain" disabled={!dirty || busy} onClick={() => setDraft(fromView(view))}>放弃更改</button>
          <button type="button" className="btn btn-candy" disabled={!dirty || busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存'}</button>
        </div>
      </header>
      <main className="admin-main">
        {notice && <p className={notice.tone === 'ok' ? 'admin-ok' : 'field-error'} role="status">{notice.text}</p>}
        {view.source === 'env' && !draft.providers.length && view.envFallback && <p className="admin-hint">目前使用部署变量里的单个模型（{view.envFallback.protocol} · {view.envFallback.model}）。在这里添加并保存提供商后，以面板配置为准。</p>}
        {view.source === 'none' && !draft.providers.length && <p className="admin-hint">还没有可用的模型：导入只能按规则排版。点「添加提供商」从模型目录里选一个。</p>}
        <Segmented label="配置分区" value={tab} onChange={setTab} options={[{ value: 'providers', label: `提供商 ${draft.providers.length}` }, { value: 'order', label: '调用顺序与用途' }, { value: 'settings', label: '模型目录' }]} />

        {tab === 'providers' && <section className="admin-section">
          <div className="fields-head"><h3>提供商</h3><button type="button" className="btn btn-tint" onClick={() => setAdding(true)}><Icon name="plus" size={16} />添加提供商</button></div>
          {draft.providers.map((p, i) => <ProviderCard key={i} provider={p} catalog={catalog} status={view.targets} onChange={fn => updateProvider(i, fn)} onRemove={() => update(d => { d.providers.splice(i, 1); return d; })} nextOrder={nextOrder} />)}
          {!draft.providers.length && <p className="admin-muted">还没有提供商。</p>}
        </section>}

        {tab === 'order' && <OrderPanel draft={draft} update={update} saved={view.targets} />}

        {tab === 'settings' && <section className="admin-section admin-card">
          <h3>模型目录</h3>
          <p className="admin-muted">目录采用 models.dev 的数据格式，用于在添加提供商和模型时预填协议、Base URL、上下文与价格。留空时使用部署变量 <code>MODEL_CATALOG_URL</code>{view.defaultCatalogUrl ? `（${view.defaultCatalogUrl}）` : '（未设置）'}。</p>
          <label className="field-label">目录地址<input className="field" value={draft.catalogUrl} placeholder={view.defaultCatalogUrl || 'https://…/api.json'} onChange={e => { const v = e.target.value; update(d => ({ ...d, catalogUrl: v })); }} /></label>
          <div className="admin-row">
            <button type="button" className="btn btn-plain" onClick={() => void loadCatalog(true)}><Icon name="sync" size={16} />立即刷新目录</button>
            <span className="admin-muted">{catalog?.fetchedAt ? `${catalog.providers.length} 家提供商 · 更新于 ${new Date(catalog.fetchedAt).toLocaleString()}` : '尚未获取'}</span>
          </div>
          {catalog?.error && <p className="field-error">{catalog.error}</p>}
          {draft.catalogUrl !== view.catalogUrl && <p className="admin-muted">保存后按新地址重新获取目录。</p>}
        </section>}
      </main>
      {adding && <AddProvider catalog={catalog} taken={draft.providers.map(p => p.id)} onClose={() => setAdding(false)} onAdd={p => { update(d => { d.providers.push(p); return d; }); setAdding(false); }} />}
    </div>
  );
}

function ProviderCard({ provider: p, catalog, status, onChange, onRemove, nextOrder }: {
  provider: DraftProvider; catalog: CatalogView | null; status: ConfigView['targets'];
  onChange: (fn: (p: DraftProvider) => void) => void; onRemove: () => void; nextOrder: () => number;
}) {
  const [open, setOpen] = useState(!!p.isNew);
  const [newKey, setNewKey] = useState({ label: '', apiKey: '' });
  const [customModel, setCustomModel] = useState('');
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [tests, setTests] = useState<Record<string, { state: 'run' | 'ok' | 'fail'; text: string }>>({});
  const source = catalog?.providers.find(c => c.id === p.catalogId);
  const callable = p.models.filter(m => status.find(t => t.id === `${p.id}/${m.id}`)?.callable).length;
  const enabledKeys = p.keys.filter(k => k.enabled).length;
  const headers = Object.entries(p.headers);

  const test = async (model: string) => {
    setTests(t => ({ ...t, [model]: { state: 'run', text: '测试中…' } }));
    const draftKey = p.keys.find(k => k.enabled && k.apiKey);
    const savedKey = p.keys.find(k => k.enabled && k.id);
    try {
      const r = await request<{ ok: boolean; ms: number; sample?: string; error?: string }>('/api/admin/llm/test', { method: 'POST', body: JSON.stringify({ provider: { id: p.id, protocol: p.protocol, baseUrl: p.baseUrl, headers: p.headers }, model, ...(draftKey ? { apiKey: draftKey.apiKey } : savedKey ? { keyId: savedKey.id } : {}) }) });
      setTests(t => ({ ...t, [model]: r.ok ? { state: 'ok', text: `可用 · ${(r.ms / 1000).toFixed(1)} 秒 · 「${r.sample}」` } : { state: 'fail', text: r.error ?? '失败' } }));
    } catch (error) { setTests(t => ({ ...t, [model]: { state: 'fail', text: (error as Error).message } })); }
  };

  return (
    <article className="admin-card provider-card" data-off={!p.enabled}>
      <header className="provider-head">
        <button type="button" className="provider-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="provider-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
          <span className="provider-title"><strong>{p.name}</strong><small>{p.id} · {PROTOCOL_OPTIONS.find(o => o.value === p.protocol)?.label} · {enabledKeys} 把 Key · {p.models.length} 个模型{p.catalogId ? ` · 目录 ${p.catalogId}` : ' · 手动'}</small></span>
          <span className="admin-badge" data-tone={callable ? 'ok' : 'warn'}>{callable ? `${callable} 个可调用` : '不可调用'}</span>
          <Icon name="chevron" size={16} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </button>
        <label className="tool-check"><input type="checkbox" checked={p.enabled} onChange={e => { const v = e.target.checked; onChange(x => { x.enabled = v; }); }} />启用</label>
      </header>
      {open && <div className="provider-body">
        <div className="field-pair">
          <label className="field-label">名称<input className="field" value={p.name} onChange={e => { const v = e.target.value; onChange(x => { x.name = v; }); }} /></label>
          <label className="field-label">编号{p.isNew ? <input className="field" value={p.id} onChange={e => { const v = slug(e.target.value); onChange(x => { x.id = v; }); }} /> : <input className="field" value={p.id} disabled title="保存后编号不可修改：Key 按编号加密" />}</label>
        </div>
        <div className="field-label">协议<Select label="协议" variant="field" value={p.protocol} options={PROTOCOL_OPTIONS} onChange={v => onChange(x => { x.protocol = v; })} /></div>
        <label className="field-label">Base URL
          <span className="admin-inline">
            <input className="field" value={p.baseUrl} placeholder={source?.baseUrl ?? '目录没有提供地址，请按服务商文档填写，如 https://…/v1'} onChange={e => { const v = e.target.value.trim(); onChange(x => { x.baseUrl = v; }); }} />
            {source?.baseUrl && source.baseUrl !== p.baseUrl && <button type="button" className="btn btn-plain" onClick={() => onChange(x => { x.baseUrl = source.baseUrl!; })}>↺ 目录值</button>}
            {source?.doc && <a className="btn btn-plain" href={source.doc} target="_blank" rel="noreferrer"><Icon name="external" size={15} />文档</a>}
          </span>
        </label>

        <h4>Key</h4>
        <ul className="admin-list">
          {p.keys.map((k, ki) => <li key={k.id ?? `new-${ki}`}>
            <label className="tool-check"><input type="checkbox" checked={k.enabled} onChange={e => { const v = e.target.checked; onChange(x => { x.keys[ki].enabled = v; }); }} /></label>
            <input className="field admin-narrow" aria-label="Key 备注" placeholder="备注" value={k.label} onChange={e => { const v = e.target.value; onChange(x => { x.keys[ki].label = v; }); }} />
            <code>{k.masked ?? `••••${k.apiKey?.slice(-4)}`}</code>
            <span className="admin-muted">{k.apiKey ? '待保存' : k.addedAt ? `添加于 ${new Date(k.addedAt).toLocaleDateString()}` : ''}</span>
            <button type="button" className="icon-btn" aria-label="删除这把 Key" onClick={() => onChange(x => { x.keys.splice(ki, 1); })}><Icon name="trash" size={16} /></button>
          </li>)}
        </ul>
        <div className="admin-inline">
          <input className="field admin-narrow" placeholder="备注（可选）" value={newKey.label} onChange={e => setNewKey(k => ({ ...k, label: e.target.value }))} />
          <input className="field" type="password" autoComplete="off" placeholder="粘贴 API Key" value={newKey.apiKey} onChange={e => setNewKey(k => ({ ...k, apiKey: e.target.value }))} />
          <button type="button" className="btn btn-tint" disabled={newKey.apiKey.trim().length < 8} onClick={() => { onChange(x => { x.keys.push({ label: newKey.label, apiKey: newKey.apiKey.trim(), enabled: true }); }); setNewKey({ label: '', apiKey: '' }); }}>添加 Key</button>
        </div>
        <p className="admin-muted">Key 只写入：保存后加密存储，页面只显示末 4 位。同一模型按顺序依次尝试启用的 Key。</p>

        <h4>模型</h4>
        <ul className="admin-list">
          {p.models.map((m, mi) => {
            const info = status.find(t => t.id === `${p.id}/${m.id}`);
            const t = tests[m.id];
            return <li key={m.id}>
              <label className="tool-check"><input type="checkbox" checked={m.enabled} onChange={e => { const v = e.target.checked; onChange(x => { x.models[mi].enabled = v; }); }} /></label>
              <code className="admin-model">{m.id}</code>
              {info && !info.callable && <span className="admin-badge" data-tone="warn">{REASON[info.reason ?? ''] ?? '不可调用'}</span>}
              {!info && <span className="admin-badge">待保存</span>}
              <button type="button" className="btn btn-plain" disabled={t?.state === 'run' || !p.baseUrl || !p.keys.some(k => k.enabled)} onClick={() => void test(m.id)}>测试</button>
              <button type="button" className="icon-btn" aria-label={`移除 ${m.id}`} onClick={() => onChange(x => { x.models.splice(mi, 1); })}><Icon name="trash" size={16} /></button>
              {t && <span className="admin-test" data-state={t.state}>{t.text}</span>}
            </li>;
          })}
        </ul>
        <div className="admin-inline">
          {p.catalogId && <button type="button" className="btn btn-tint" onClick={() => setPicking(v => !v)}><Icon name="search" size={15} />{picking ? '收起目录' : '从目录选模型'}</button>}
          <input className="field" placeholder="或手动输入模型 id" value={customModel} onChange={e => setCustomModel(e.target.value.trim())} />
          <button type="button" className="btn btn-plain" disabled={!customModel || p.models.some(m => m.id === customModel)} onClick={() => { const order = nextOrder(); onChange(x => { x.models.push({ id: customModel, enabled: true, order }); }); setCustomModel(''); }}>添加</button>
        </div>
        {picking && p.catalogId && <ModelPicker catalogId={p.catalogId} chosen={p.models.map(m => m.id)} onPick={id => { const order = nextOrder(); onChange(x => { if (!x.models.some(m => m.id === id)) x.models.push({ id, enabled: true, order }); }); }} />}

        <details className="admin-details">
          <summary>附加请求头（{headers.length}）</summary>
          <p className="admin-muted">个别网关要求额外请求头（如会话或来源标识）。鉴权头由协议自动设置，不能在这里填写。</p>
          {headers.map(([k, v], hi) => <div className="admin-inline" key={hi}>
            <input className="field admin-narrow" value={k} aria-label="请求头名" onChange={e => { const name = e.target.value; onChange(x => { const entries = Object.entries(x.headers); entries[hi] = [name, v]; x.headers = Object.fromEntries(entries); }); }} />
            <input className="field" value={v} aria-label="请求头值" onChange={e => { const value = e.target.value; onChange(x => { x.headers[k] = value; }); }} />
            <button type="button" className="icon-btn" aria-label="删除请求头" onClick={() => onChange(x => { delete x.headers[k]; })}><Icon name="trash" size={16} /></button>
          </div>)}
          <button type="button" className="btn btn-plain" onClick={() => onChange(x => { let n = 1; while (`x-header-${n}` in x.headers) n++; x.headers[`x-header-${n}`] = ''; })}><Icon name="plus" size={15} />添加请求头</button>
        </details>

        <footer className="admin-row admin-danger-row">
          {confirmRemove ? <><span>删除「{p.name}」及其全部 Key 和模型？</span><button type="button" className="btn btn-danger" onClick={onRemove}>删除</button><button type="button" className="btn btn-plain" onClick={() => setConfirmRemove(false)}>取消</button></>
            : <button type="button" className="btn btn-plain" onClick={() => setConfirmRemove(true)}><Icon name="trash" size={15} />删除提供商</button>}
        </footer>
      </div>}
    </article>
  );
}

function ModelPicker({ catalogId, chosen, onPick }: { catalogId: string; chosen: string[]; onPick: (id: string) => void }) {
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    request<{ models: CatalogModel[] }>(`/api/admin/catalog/models?provider=${encodeURIComponent(catalogId)}`).then(r => setModels(r.models)).catch(e => setError((e as Error).message));
  }, [catalogId]);
  const shown = useMemo(() => (models ?? []).filter(m => !q || `${m.id} ${m.name}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.updated ?? b.released ?? '').localeCompare(a.updated ?? a.released ?? '')).slice(0, 60), [models, q]);
  if (error) return <p className="field-error">{error}</p>;
  if (!models) return <p className="admin-muted">正在读取目录…</p>;
  return <div className="model-picker">
    <input className="field" placeholder={`在 ${models.length} 个模型中搜索`} value={q} onChange={e => setQ(e.target.value)} autoFocus />
    <ul>
      {shown.map(m => <li key={m.id}>
        <label className="tool-check"><input type="checkbox" checked={chosen.includes(m.id)} disabled={chosen.includes(m.id)} onChange={() => onPick(m.id)} />
          <span><strong>{m.name}</strong> <code>{m.id}</code>
            <small>上下文 {fmtTokens(m.context)} · 输出 {fmtTokens(m.output)}{m.costIn != null ? ` · $${m.costIn}/$${m.costOut} 每百万` : ''}{m.reasoning ? ' · 推理' : ''}{m.images ? ' · 图像输入' : ''}{m.updated ?? m.released ? ` · ${m.updated ?? m.released}` : ''}{m.status ? ` · ${m.status === 'deprecated' ? '已弃用' : m.status}` : ''}</small>
          </span>
        </label>
      </li>)}
    </ul>
    {(models.length > shown.length) && <p className="admin-muted">只显示前 60 个结果，请输入关键词缩小范围。</p>}
  </div>;
}

function AddProvider({ catalog, taken, onClose, onAdd }: { catalog: CatalogView | null; taken: string[]; onClose: () => void; onAdd: (p: DraftProvider) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const results = useMemo(() => (catalog?.providers ?? []).filter(c => !q || `${c.id} ${c.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 40), [catalog, q]);
  const unique = (base: string) => { let id = slug(base), n = 2; while (taken.includes(id)) id = `${slug(base)}-${n++}`; return id; };
  const choose = (c: CatalogProvider) => onAdd({ id: unique(c.id), name: c.name, catalogId: c.id, protocol: c.protocol ?? 'openai-chat', baseUrl: c.baseUrl ?? '', enabled: true, headers: {}, keys: [], models: [], isNew: true });
  const manual = () => onAdd({ id: unique(q || 'custom'), name: q || '自定义提供商', catalogId: null, protocol: 'openai-chat', baseUrl: '', enabled: true, headers: {}, keys: [], models: [], isNew: true });
  return <dialog ref={dialog} className="admin-dialog" onClose={onClose} onCancel={onClose}>
    <div className="admin-dialog-body">
      <div className="fields-head"><h3>添加提供商</h3><button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}><Icon name="close" size={16} /></button></div>
      <input className="field" role="combobox" aria-expanded="true" aria-controls="catalog-results" placeholder={catalog?.providers.length ? `搜索 ${catalog.providers.length} 家提供商` : '目录不可用，可直接手动添加'} value={q} autoFocus
        onChange={e => { setQ(e.target.value); setActive(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active]); }
        }} />
      {catalog?.error && <p className="field-error">{catalog.error}</p>}
      <ul id="catalog-results" role="listbox" className="catalog-results">
        {results.map((c, i) => <li key={c.id} role="option" aria-selected={i === active}>
          <button type="button" data-active={i === active} onPointerMove={() => setActive(i)} onClick={() => choose(c)}>
            <strong>{c.name}</strong><code>{c.id}</code>
            <small>{c.modelCount} 个模型 · {c.protocol ? PROTOCOL_OPTIONS.find(o => o.value === c.protocol)?.label : `暂不支持的协议（${c.npm || '未知'}），将按 OpenAI 兼容预填，请核对`}{c.baseUrl ? '' : ' · 需要手填 Base URL'}</small>
          </button>
        </li>)}
      </ul>
      <footer className="admin-row"><button type="button" className="btn btn-plain" onClick={manual}><Icon name="plus" size={15} />手动添加{q ? `「${q}」` : ''}</button></footer>
    </div>
  </dialog>;
}

function OrderPanel({ draft, update, saved }: { draft: Draft; update: (fn: (d: Draft) => Draft) => void; saved: ConfigView['targets'] }) {
  const all = draft.providers.flatMap(p => p.models.map(m => ({ id: `${p.id}/${m.id}`, provider: p, model: m }))).sort((a, b) => a.model.order - b.model.order);
  const statusOf = (id: string) => {
    const t = all.find(x => x.id === id);
    if (!t) return '已不存在';
    if (!t.provider.enabled) return REASON.provider_disabled;
    if (!t.model.enabled) return REASON.model_disabled;
    if (!t.provider.keys.some(k => k.enabled)) return REASON.no_key;
    return '';
  };
  /** Local reorder only; the draft is saved with the page. */
  const reorder = (from: number, to: number) => update(d => {
    const list = d.providers.flatMap(p => p.models).sort((a, b) => a.order - b.order);
    if (to < 0 || to >= list.length) return d;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    list.forEach((m, i) => { m.order = i; });
    return d;
  });
  return <section className="admin-section">
    <div className="admin-card">
      <h3>全局调用顺序</h3>
      <p className="admin-muted">每次调用按此顺序尝试，同一模型依次换 Key；超时、限流、5xx 或网络错误都会换下一个。</p>
      {all.length ? <SortableList items={all} keyOf={t => t.id} label={t => t.id} onMove={reorder}>
        {(t, i, handle) => <>
          <Grip {...handle} />
          <span className="order-index">{i + 1}</span><code>{t.id}</code>
          {statusOf(t.id) ? <span className="admin-badge" data-tone="warn">{statusOf(t.id)}</span> : <span className="admin-badge" data-tone="ok">可调用</span>}
          {!saved.some(s => s.id === t.id) && <span className="admin-badge">待保存</span>}
          <span className="order-actions">
            <button type="button" className="icon-btn" aria-label="上移" disabled={i === 0} onClick={() => reorder(i, i - 1)}><Icon name="up" size={15} /></button>
            <button type="button" className="icon-btn" aria-label="下移" disabled={i === all.length - 1} onClick={() => reorder(i, i + 1)}><Icon name="down" size={15} /></button>
          </span>
        </>}
      </SortableList> : <p className="admin-muted">还没有模型。</p>}
    </div>
    {(['annotate', 'plan'] as Purpose[]).map(purpose => {
      const cfg = draft.purposes[purpose];
      const set = (fn: (c: PurposeConfig) => void) => update(d => { fn(d.purposes[purpose]); return d; });
      const pinned = cfg.targets;
      return <div className="admin-card" key={purpose}>
        <h3>{PURPOSE_LABEL[purpose].title}</h3>
        <p className="admin-muted">{PURPOSE_LABEL[purpose].detail}。不选模型时按全局顺序；选了则只按这里的顺序调用。</p>
        <div className="purpose-targets">
          {all.map(t => <label key={t.id} className="tool-check"><input type="checkbox" checked={pinned.includes(t.id)} onChange={e => { const on = e.target.checked; set(c => { c.targets = on ? [...c.targets, t.id] : c.targets.filter(x => x !== t.id); }); }} /><code>{t.id}</code></label>)}
        </div>
        {pinned.length > 0 && <SortableList items={pinned} keyOf={id => id} label={id => id} onMove={(from, to) => set(c => { const [m] = c.targets.splice(from, 1); c.targets.splice(to, 0, m); })}>
          {(id, i, handle) => <>
            <Grip {...handle} />
            <span className="order-index">{i + 1}</span><code>{id}</code>{statusOf(id) && <span className="admin-badge" data-tone="warn">{statusOf(id)}</span>}
            <span className="order-actions">
              <button type="button" className="icon-btn" aria-label="上移" disabled={i === 0} onClick={() => set(c => { [c.targets[i - 1], c.targets[i]] = [c.targets[i], c.targets[i - 1]]; })}><Icon name="up" size={15} /></button>
              <button type="button" className="icon-btn" aria-label="下移" disabled={i === pinned.length - 1} onClick={() => set(c => { [c.targets[i + 1], c.targets[i]] = [c.targets[i], c.targets[i + 1]]; })}><Icon name="down" size={15} /></button>
            </span>
          </>}
        </SortableList>}
        <div className="field-pair">
          <label className="field-label">输出上限（token）<input className="field" type="number" min={64} max={64000} step={100} value={cfg.maxTokens} onChange={e => { const v = Number(e.target.value); set(c => { c.maxTokens = v; }); }} /></label>
          <label className="field-label">单次超时（秒）<input className="field" type="number" min={3} max={180} value={Math.round(cfg.timeoutMs / 1000)} onChange={e => { const v = Number(e.target.value) * 1000; set(c => { c.timeoutMs = v; }); }} /></label>
        </div>
      </div>;
    })}
  </section>;
}
