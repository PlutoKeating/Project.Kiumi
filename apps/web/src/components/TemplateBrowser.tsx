import { useEffect, useRef, useState } from 'react';
import { fetchRooms, fetchTemplate, type Room, type TemplateIndexEntry } from '../api.ts';
import { sanitizeHtml } from '@kiumi/core';
import { pauseCatalogSync, syncCatalog, SYNC_STATUS } from '../lib/catalog-sync.ts';
import { CATALOG_UPDATED } from '../lib/catalog-cache.ts';
import { readableName } from '../lib/template-name.ts';
import { ROOM_GROUPS, useStore } from '../store.ts';
import { Icon } from './Icon.tsx';
import { PanelState } from './PanelState.tsx';
import { Droplet, IconButton, Segmented, Select, useDroplet } from './ui.tsx';

function TemplateCard({ item, onPick }: { item: TemplateIndexEntry; onPick: () => void }) {
  const hasSelection = useStore(s => s.selected !== null);
  const favorite = useStore(s => s.favorites.includes(item.atomTplId));
  const applyStyle = useStore(s => s.applyTemplateStyle);
  const toggleFavorite = useStore(s => s.toggleFavorite);
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

  const name = readableName(item.displayName);
  return (
    <article className="tpl" title={name || undefined}>
      <div ref={holder} className="tpl-preview">
        {visible && html && (
          <iframe
            title={`${item.displayName}预览`}
            className="preview-frame"
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100vh;font:14px/1.6 sans-serif;color:#3f3f3f;background:white}body{padding:14px;display:flex;flex-direction:column;justify-content:safe center}img,svg{max-width:100%;height:auto}section,div,p{max-width:100%}p{margin:0}</style></head><body>${html}</body></html>`}
            loading="lazy"
            sandbox=""
            referrerPolicy="no-referrer"
            tabIndex={-1}
          />
        )}
        {visible && !html && (error ? <span className="tpl-state">{error}</span> : <span className="tpl-loading" />)}
        <button type="button" className="tpl-hit" aria-label={`插入模板：${item.displayName}`} onClick={onPick} />
      </div>
      {name && <p className="tpl-name">{name}</p>}
      <div className="tpl-actions">
        <button type="button" onClick={onPick} tabIndex={-1} aria-hidden="true"><Icon name="plus" size={14} />插入</button>
        <button type="button" disabled={!hasSelection} aria-label={`应用样式：${item.displayName}`} title={hasSelection ? '保留选中内容，换成这个外观' : '先在画布选中一块'} onClick={event => { event.stopPropagation(); void applyStyle(item.atomTplId); }} onKeyDown={event => event.stopPropagation()}>换样式</button>
      </div>
      <button type="button" className="tpl-star" aria-pressed={favorite} aria-label={`${favorite ? '取消收藏' : '收藏模板'}：${item.displayName}`} onClick={() => toggleFavorite(item.atomTplId)}><Icon name="star" size={15} /></button>
    </article>
  );
}

function GroupChips({ groups, rooms, active, onPick }: {
  groups: { key: string; label: string; rooms: string[] }[]; rooms: Room[]; active: string; onPick: (key: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const bead = useDroplet(root, active);
  useEffect(() => {
    const scroller = root.current, chip = scroller?.querySelector<HTMLElement>('[data-active="true"]');
    if (scroller && chip) scroller.scrollTo({ left: chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }, [active, groups.length]);
  return <div ref={root} className="chips" role="group" aria-label="模板类型">
    <Droplet bead={bead} />
    {groups.map(item => {
      const available = item.rooms.some(tag => rooms.some(room => room.tag === tag));
      return <button type="button" key={item.key} disabled={!available} aria-pressed={active === item.key} data-active={active === item.key} onClick={() => onPick(item.key)}>{item.label}</button>;
    })}
  </div>;
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
    <section className="library-panel template-browser" aria-label="图文模板">
      <div className="panel-top">
        <div className="search-row">
          <label className="search">
            <Icon name="search" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索模板名称" placeholder="搜索模板" />
            {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><Icon name="close" size={14} /></button>}
          </label>
          {view === 'recommend' && <IconButton icon="shuffle" label="换一批" className="is-soft" onClick={shuffle} />}
        </div>
        <GroupChips groups={groups} rooms={rooms} active={activeGroup} onPick={setGroup} />
        <div className="filter-row">
          <Select label="模板分类" value={activeRoom ?? ''} onChange={value => setRoom(value || null)} options={[{ value: '', label: '全部分类' }, ...groupRooms.map(room => ({ value: room.tag, label: `${room.name} · ${room.count}` }))]} />
          <Segmented label="模板来源" value={view} onChange={setView} options={[{ value: 'recommend', label: '推荐' }, { value: 'recent', label: '最近' }]} />
        </div>
      </div>

      <div className="tpl-grid">
        {view === 'recommend' && loading && templates.length === 0 && Array.from({ length: 6 }, (_, index) => <div className="tpl-skeleton" key={index} />)}
        {view === 'recent' && recent.length === 0 && <PanelState icon="template" title="这里会记住用过的模板" detail="插入过的模板会出现在这里，方便再次使用。" />}
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
          <PanelState icon="search" title="没有匹配的模板" detail="试试其他分类或关键词。" action={query ? '清空搜索' : undefined} onAction={() => setQuery('')} />
        )}
      </div>

      <footer className="panel-foot">
        <span title={syncStatus}>{syncPaused ? '后台同步已暂停' : syncStatus}</span>
        <em>{loading ? '加载中' : `${templates.length} 个`}</em>
        <button type="button" aria-label={syncPaused ? '继续同步' : '暂停同步'} data-tip={syncPaused ? '继续同步' : '暂停同步'} onClick={() => { pauseCatalogSync(!syncPaused); setSyncPaused(!syncPaused); if (syncPaused) void syncCatalog(); }}><Icon name={syncPaused ? 'play' : 'pause'} size={13} /></button>
      </footer>
    </section>
  );
}
