const RAIL_ITEMS = [
  { key: 'templates', label: '图文模板', glyph: '▤' },
  { key: 'assets', label: '图片素材', glyph: '▣' },
  { key: 'favorites', label: '图文收藏', glyph: '★' },
  { key: 'clipboard', label: '剪贴板', glyph: '⎘' },
  { key: 'gallery', label: '我的图库', glyph: '⌸' },
];

export function LeftRail({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="w-[76px] shrink-0 bg-ink-800 text-mist-100 flex flex-col items-center py-3 gap-1">
      {RAIL_ITEMS.map((item) => (
        <button
          key={item.key}
          onClick={() => onSelect(item.key)}
          className={`w-[64px] py-2 rounded-lg text-[11px] leading-tight flex flex-col items-center gap-1 transition ${
            active === item.key
              ? 'bg-accent-500 text-white'
              : 'text-mist-200/70 hover:bg-ink-700 hover:text-white'
          }`}
        >
          <span className="text-lg leading-none">{item.glyph}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
