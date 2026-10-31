import { useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { Droplet, useDroplet } from './ui.tsx';

const RAIL_ITEMS: readonly { key: string; label: string; short: string; icon: IconName }[] = [
  { key: 'templates', label: '图文模板', short: '模板', icon: 'template' },
  { key: 'assets', label: '图片素材', short: '素材', icon: 'image' },
  { key: 'favorites', label: '图文收藏', short: '收藏', icon: 'star' },
  { key: 'clipboard', label: '剪贴板', short: '剪贴板', icon: 'clipboard' },
  { key: 'gallery', label: '我的图库', short: '图库', icon: 'gallery' },
];

/** Navigation and what it opens are one sheet of glass: choosing a section never moves your eye far. */
export function ResourceIsland({ active, onSelect, collapsed, onToggleCollapse, children }: {
  active: string; onSelect: (key: string) => void; collapsed: boolean; onToggleCollapse: () => void; children: ReactNode;
}) {
  const rail = useRef<HTMLElement>(null);
  const bead = useDroplet(rail, active);
  return (
    <div className="island resource-island">
      <nav ref={rail} className="rail" aria-label="资源">
        <Droplet bead={bead} tone={active} />
        {RAIL_ITEMS.map((item) => (
          <button
            type="button"
            key={item.key}
            aria-label={item.label}
            data-section={item.key}
            data-active={active === item.key}
            aria-current={active === item.key ? 'page' : undefined}
            onClick={() => onSelect(item.key)}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.short}</span>
          </button>
        ))}
        <button type="button" className="rail-collapse" aria-label={collapsed ? '展开资源面板' : '收起资源面板'} aria-expanded={!collapsed} data-tip={collapsed ? '展开' : '收起'} data-tip-side="right" onClick={onToggleCollapse}>
          <Icon name="sidebar" size={19} />
        </button>
      </nav>
      {!collapsed && <div className="resource-body">{children}</div>}
    </div>
  );
}
