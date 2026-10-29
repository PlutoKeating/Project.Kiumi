import { useEffect, useRef, useState } from 'react';
import { previewUrl, type Room, type TemplateIndexEntry } from '../api.ts';
import { ROOM_GROUPS, useStore } from '../store.ts';

function TemplateCard({ item, onPick }: { item: TemplateIndexEntry; onPick: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

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
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onPick();
      }}
      className="group flex flex-col h-[164px] text-left rounded-lg border border-mist-200 bg-white overflow-hidden hover:border-accent-400 hover:shadow-sm transition cursor-pointer"
      title={item.atomTplId}
    >
      <div ref={holder} className="h-[132px] shrink-0 overflow-hidden bg-mist-50">
        {visible && (
          <iframe
            className="preview-frame"
            src={previewUrl(item.atomTplId)}
            loading="lazy"
            sandbox=""
            referrerPolicy="no-referrer"
            tabIndex={-1}
          />
        )}
      </div>
      <div className="h-[32px] px-2 text-[11px] text-ink-600 flex items-center justify-between gap-2">
        <span className="truncate">{item.displayName}</span>
        <span className="shrink-0 text-[10px] text-ink-600/50">
          {item.hasSvg ? 'SVG' : item.byteSize > 4000 ? '长' : ''}
        </span>
      </div>
    </div>
  );
}

export function TemplateBrowser() {
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

  const [openGroup, setOpenGroup] = useState<string | null>(null);

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
    <section className="w-[360px] shrink-0 bg-ink-700 text-mist-100 flex flex-col min-h-0">
      <div className="flex items-stretch border-b border-white/10 relative overflow-x-auto">
        {groups.map((item) => {
          const available = item.rooms.some((tag) => rooms.some((room) => room.tag === tag));
          return (
            <button
              key={item.key}
              disabled={!available}
              onMouseEnter={() => setOpenGroup(item.key)}
              onMouseLeave={() => setOpenGroup((current) => (current === item.key ? null : current))}
              onClick={() => setGroup(item.key)}
              className={`flex-1 shrink-0 whitespace-nowrap px-2 py-2.5 text-[13px] transition ${
                activeGroup === item.key
                  ? 'text-white border-b-2 border-accent-400'
                  : available
                    ? 'text-mist-200/70 hover:text-white'
                    : 'text-mist-200/25 cursor-not-allowed'
              }`}
            >
              {item.label}
            </button>
          );
        })}

        {openGroup && (
          <div
            className="absolute left-0 right-0 top-full z-20 bg-ink-600 border-t border-white/10 shadow-xl"
            onMouseEnter={() => setOpenGroup(openGroup)}
            onMouseLeave={() => setOpenGroup(null)}
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-3">
              {(groups.find((item) => item.key === openGroup)?.rooms ?? []).map((tag) => {
                const room = rooms.find((entry) => entry.tag === tag);
                if (!room) return null;
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      setGroup(openGroup);
                      setRoom(tag);
                      setOpenGroup(null);
                    }}
                    className={`text-left text-[12px] px-2 py-1 rounded hover:bg-white/10 ${
                      activeRoom === tag ? 'text-accent-400' : 'text-mist-100'
                    }`}
                  >
                    {room.name}
                    <span className="ml-1 text-[10px] text-mist-200/40">{room.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 text-[11px]">
        {(['recommend', 'recent'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`px-1.5 py-0.5 rounded ${
              view === mode ? 'bg-white/15 text-white' : 'text-mist-200/60 hover:text-white'
            }`}
          >
            {mode === 'recommend' ? '推荐模板' : '最近使用'}
          </button>
        ))}
        <span className="text-mist-200/25">样刊模板</span>
        <span className="ml-auto text-mist-200/25">主题色</span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索模板名称"
          className="flex-1 bg-ink-800 border border-white/10 rounded px-2 py-1.5 text-[12px] text-mist-100 placeholder:text-mist-200/30 focus:outline-none focus:border-accent-400"
        />
        {view === 'recommend' && (
          <button
            onClick={shuffle}
            className="shrink-0 text-[11px] px-2 py-1.5 rounded border border-white/15 text-mist-100 hover:bg-white/10"
            title="换一批"
          >
            换一换
          </button>
        )}
      </div>

      <div className="px-3 py-1.5 text-[11px] text-mist-200/50 flex items-center justify-between">
        <span>{roomLabel(groupRooms, activeRoom)}</span>
        <span>{loading ? '加载中…' : `${templates.length} 个`}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 grid grid-cols-2 gap-2 content-start">
        {view === 'recent' && recent.length === 0 && (
          <p className="col-span-2 text-[12px] text-mist-200/40 py-6 text-center">还没有使用过模板</p>
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
        {!loading && templates.length === 0 && (
          <p className="col-span-2 text-[12px] text-mist-200/40 py-6 text-center">没有匹配的模板</p>
        )}
      </div>
    </section>
  );
}

function roomLabel(rooms: Room[], activeRoom: string | null): string {
  const room = rooms.find((entry) => entry.tag === activeRoom);
  if (!room) return '全部';
  return room.name;
}
