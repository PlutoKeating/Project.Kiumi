import { useEffect, useRef, useState } from 'react';
import { fetchRooms, fetchTemplate, type Room, type TemplateIndexEntry } from '../api.ts';
import { sanitizeHtml } from '@kiumi/core';
import { pauseCatalogSync, syncCatalog, SYNC_STATUS } from '../lib/catalog-sync.ts';
import { CATALOG_UPDATED } from '../lib/catalog-cache.ts';
import { ROOM_GROUPS, useStore } from '../store.ts';

function TemplateCard({ item, onPick }: { item: TemplateIndexEntry; onPick: () => void }) {
  const selected = useStore(s => s.selected);
  const applyStyle = useStore(s => s.applyTemplateStyle);
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const load = () => { void fetchTemplate(item.atomTplId).then(record => {
      if (alive) { setHtml(sanitizeHtml(record.html)); setError(''); }
    }).catch(() => { if (alive) setError('模板暂未加载，点击重试'); }); };
    const updated = (event: Event) => { if ((event as CustomEvent<string>).detail === `/api/template?id=${encodeURIComponent(item.atomTplId)}&localAssets=true`) load(); };
    load(); window.addEventListener(CATALOG_UPDATED, updated);
    return () => { alive = false; window.removeEventListener(CATALOG_UPDATED, updated); };
  }, [visible, item.atomTplId]);

  // Dozens of previews on one screen: mount the frame only when the card comes
  // close to the viewport, otherwise every scroll starts a request.
  useEffect(() => {
    const node = holder.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div
      className="template-card group flex flex-col h-[224px] text-left rounded-lg border border-mist-200 bg-white overflow-hidden hover:border-accent-400 hover:shadow-sm transition cursor-pointer"
      title={item.atomTplId}
    >
      <div ref={holder} className="relative h-[144px] shrink-0 overflow-hidden bg-mist-50">
        {visible && html && (
          <iframe
            title={`${item.displayName}预览`}
            className="preview-frame"
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:6px;font:14px/1.6 sans-serif;color:#3f3f3f;background:white}img,svg{max-width:100%;height:auto}section,div,p{max-width:100%}p{margin:0}</style></head><body>${html}</body></html>`}
            loading="lazy"
            sandbox=""
            referrerPolicy="no-referrer"
            tabIndex={-1}
          />
        )}
        {visible && !html && <span className="text-xs text-ink-600 p-2">{error || '加载模板…'}</span>}
        <button className="template-insert" aria-label={`插入模板：${item.displayName}`} onClick={onPick} />
      </div>
      <div className="h-[32px] px-2 text-[11px] text-ink-600 flex items-center justify-between gap-2">
        <span className="truncate">{item.displayName}</span>
        <span className="shrink-0 text-[10px] text-ink-600/50">
          {item.hasSvg ? 'SVG' : item.byteSize > 4000 ? '长' : ''}
        </span>
      </div>
      <div className="flex items-center px-2 pb-2 gap-2">
        <button className="template-insert-label" onClick={onPick}>插入</button>
        <button disabled={selected === null} onClick={event => { event.stopPropagation(); void applyStyle(item.atomTplId); }} onKeyDown={event => event.stopPropagation()} className="ml-auto min-h-8 px-2 text-[11px] border border-mist-200 rounded text-accent-500 disabled:opacity-40 hover:bg-mist-100" title="保留选中块内容，应用此模板的外观">应用样式</button>
      </div>
    </div>
  );
}

export function TemplateBrowser() {
  const [syncStatus, setSyncStatus] = useState('模板将自动缓存到本机');
  const [syncPaused, setSyncPaused] = useState(false);
  useEffect(() => {
    const updated = (event: Event) => setSyncStatus((event as CustomEvent<string>).detail);
    window.addEventListener(SYNC_STATUS, updated);
    const timer = setTimeout(() => { if (import.meta.env.PROD) void syncCatalog(); }, 5000);
    return () => { clearTimeout(timer); window.removeEventListener(SYNC_STATUS, updated); };
  }, []);
  const rooms = useStore((state) => state.rooms);
  const activeGroup = useStore((state) => state.activeGroup);
  const activeRoom = useStore((state) => state.activeRoom);
  const query = useStore((state) => state.query);
  const templates = useStore((state) => state.templates);
  const loading = useStore((state) => state.loading);
  const view = useStore((state) => state.view);
  const recent = useStore((state) => state.recent);
  const setView = useStore((state) => state.setView);
  const shuffle = useStore((state) => state.shuffle);
  const setGroup = useStore((state) => state.setGroup);
  const setRoom = useStore((state) => state.setRoom);
  const setQuery = useStore((state) => state.setQuery);
  const insertTemplate = useStore((state) => state.insertTemplate);

  useEffect(() => {
    const updated = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (path.startsWith('/api/templates?')) void useStore.getState().reloadTemplates();
      if (path === '/api/rooms') void fetchRooms().then(rooms => useStore.setState({rooms})).catch(() => {});
    };
    window.addEventListener(CATALOG_UPDATED, updated);
    return () => window.removeEventListener(CATALOG_UPDATED, updated);
  }, []);

  // The live tag corpus supersedes the archived rooms; mark the old ones so the
  // same name never appears twice without a qualifier.
  const modernGroups = rooms
    .filter((room) => room.tag.startsWith('modern:') && room.count > 0)
    .map((room) => ({
      key: room.tag,
      label: room.name,
      rooms: [room.tag],
    }));
  // Keep the tab bar short: modern groups plus one entry for the archived rooms.
  const legacyParts = ROOM_GROUPS.filter((group) =>
    group.rooms.some((tag) => rooms.some((room) => room.tag === tag)),
  );
  const groups = modernGroups.length
    ? [
        ...modernGroups,
        {
          key: 'legacy',
          label: '旧版',
          rooms: legacyParts.flatMap((group) => group.rooms),
        },
      ]
    : ROOM_GROUPS;

  const group = groups.find((item) => item.key === activeGroup);
  const groupRooms: Room[] = rooms.filter((room) => group?.rooms.includes(room.tag));

  return (
    <section className="library-panel template-browser w-[360px] shrink-0 bg-mist-50 text-ink-600 flex flex-col min-h-0">
      <div className="template-categories flex items-stretch border-b border-mist-200 relative overflow-x-auto">
        {groups.map((item) => {
          const available = item.rooms.some((tag) => rooms.some((room) => room.tag === tag));
          return (
            <button
              key={item.key}
              disabled={!available}
              aria-pressed={activeGroup === item.key}
              onClick={() => setGroup(item.key)}
              className={`flex-1 shrink-0 whitespace-nowrap px-2 py-2.5 text-[13px] transition ${
                activeGroup === item.key
                  ? 'text-accent-500 border-b-2 border-accent-400'
                  : available
                    ? 'text-ink-600 hover:text-ink-900'
                    : 'text-ink-600 cursor-not-allowed'
              }`}
            >
              {item.label}
            </button>
          );
        })}

      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-mist-200 text-[11px]">
        {(['recommend', 'recent'] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={view === mode}
            onClick={() => setView(mode)}
            className={`px-1.5 py-0.5 rounded ${
              view === mode ? 'bg-accent-500/10 text-accent-500' : 'text-ink-600 hover:text-ink-900'
            }`}
          >
            {mode === 'recommend' ? '推荐模板' : '最近使用'}
          </button>
        ))}

      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-mist-200">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索模板名称"
          placeholder="搜索模板名称"
          className="flex-1 bg-white border border-mist-200 rounded px-2 py-1.5 text-[12px] text-ink-600 placeholder:text-ink-600 focus:outline-none focus:border-accent-400"
        />
        {view === 'recommend' && (
          <button
            onClick={shuffle}
            className="shrink-0 text-[11px] px-2 py-1.5 rounded border border-mist-200 text-ink-600 hover:bg-mist-100"
            title="换一批"
          >
            换一换
          </button>
        )}
      </div>

      <div className="px-3 py-1.5 text-[11px] text-ink-600 flex items-center justify-between">
        <select aria-label="模板分类" className="category-select" value={activeRoom ?? ''} onChange={event => setRoom(event.target.value || null)}>
          <option value="">全部分类</option>
          {groupRooms.map(room => <option key={room.tag} value={room.tag}>{room.name} · {room.count}</option>)}
        </select>
        <span>{loading ? '加载中…' : `${templates.length} 个`}</span>
      </div>

      <div className="px-3 py-1 text-[10px] text-ink-600 flex items-center gap-2">
        <span className="truncate flex-1" title={syncStatus}>{syncPaused ? '模板后台同步已暂停' : syncStatus}</span>
        <button onClick={() => { pauseCatalogSync(!syncPaused); setSyncPaused(!syncPaused); if (syncPaused) void syncCatalog(); }} className="shrink-0 hover:text-ink-900">{syncPaused ? '继续同步' : '暂停同步'}</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4 grid grid-cols-2 gap-2 content-start">
        {view === 'recent' && recent.length === 0 && (
          <p className="col-span-2 text-[12px] text-ink-600 py-6 text-center">还没有使用过模板</p>
        )}
        {view === 'recent' &&
          recent.map((item) => (
            <TemplateCard
              key={item.id}
              item={{
                atomTplId: item.id,
                displayName: item.name,
                room: 'recent',
                accessibility: 'Public',
                hasSvg: false,
                hasAnimation: false,
                byteSize: 0,
              }}
              onPick={() => void insertTemplate(item.id)}
            />
          ))}
        {view === 'recommend' && templates.map((item) => (
          <TemplateCard key={item.atomTplId} item={item} onPick={() => void insertTemplate(item.atomTplId)} />
        ))}
        {view === 'recommend' && !loading && templates.length === 0 && (
          <p className="col-span-2 text-[12px] text-ink-600 py-6 text-center">没有匹配的模板。试试其他分类或关键词。</p>
        )}
      </div>
    </section>
  );
}
