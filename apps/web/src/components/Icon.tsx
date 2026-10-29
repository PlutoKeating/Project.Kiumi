import type { CSSProperties } from 'react';
const paths = {
  template: 'M3 3h18v18H3z M3 9h18 M9 9v12', image: 'M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M16 7h.01',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  copy: 'M8 8h13v13H8z M16 8V3H3v13h5', gallery: 'M3 6h18v15H3z M7 3h10 M3 16l5-5 5 5 3-3 5 5',
  pin: 'm8 3 8 0-1 6 4 4H5l4-4z M12 13v8', trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  chevron: 'm8 10 4 4 4-4', close: 'm6 6 12 12 M6 18 18 6', more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  align: 'M4 5h16 M4 10h10 M4 15h16 M4 20h10', brush: 'm14 3 7 7-9 9-7-7z M5 12l-2 9 9-2',
  locate: 'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8z',
  plus: 'M12 5v14 M5 12h14', arrow: 'm14 6-6 6 6 6', check: 'm5 12 4 4L19 6',
};
export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
