import { Icon } from './Icon.tsx';
const RAIL_ITEMS = [
  { key: 'templates', label: '图文模板', glyph: 'template' },
  { key: 'assets', label: '图片素材', glyph: 'image' },
  { key: 'favorites', label: '图文收藏', glyph: 'star' },
  { key: 'clipboard', label: '剪贴板', glyph: 'copy' },
  { key: 'gallery', label: '我的图库', glyph: 'gallery' },
] as const;

export function LeftRail({
  active,
  onSelect,
  collapsed,
  onToggleCollapse,
}: {
  active: string;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <nav className="left-rail w-[76px] shrink-0 bg-ink-800 text-mist-100 flex flex-col items-center py-3 gap-1">
      {RAIL_ITEMS.map((item) => (
        <button
          key={item.key}
          data-section={item.key}
          aria-current={active === item.key ? "page" : undefined}
          onClick={() => onSelect(item.key)}
          className={`w-[64px] py-2 rounded-lg text-[11px] leading-tight flex flex-col items-center gap-1 transition ${
            active === item.key
              ? 'bg-accent-500 text-white'
              : 'text-mist-200/70 hover:bg-ink-700 hover:text-white'
          }`}
        >
          <Icon name={item.glyph} size={21} />
          <span>{item.label}</span>
        </button>
      ))}
      <button
        onClick={onToggleCollapse}
        className="mt-auto w-[64px] py-2 text-[11px] text-mist-200/50 hover:text-white"
        title={collapsed ? '展开' : '收起'}
      >
        <Icon name="arrow" size={16} style={{ transform: collapsed ? "rotate(180deg)" : undefined }} /><span>{collapsed ? "展开" : "收起"}</span>
      </button>
    </nav>
  );
}
