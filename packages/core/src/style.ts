import type { StyleMap, StyleValue } from './types.ts';

/** Style keys that belong to the editor, not to CSS. */
const NON_CSS_KEYS = new Set([
  'tnyzkfontusageid',
  'tnstyle',
  'tnstyleid',
  'tncolorpalette',
]);

/** Properties whose bare numeric value should be interpreted as pixels. */
const LENGTH_PROPS = new Set([
  'width',
  'height',
  'minwidth',
  'minheight',
  'maxwidth',
  'maxheight',
  'margin',
  'margintop',
  'marginright',
  'marginbottom',
  'marginleft',
  'padding',
  'paddingtop',
  'paddingright',
  'paddingbottom',
  'paddingleft',
  'fontsize',
  'lineheight',
  'letterspacing',
  'textindent',
  'borderradius',
  'borderwidth',
  'top',
  'right',
  'bottom',
  'left',
]);

export function kebabCase(name: string): string {
  if (name.includes('-')) return name.toLowerCase();
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function serializeValue(key: string, value: StyleValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return LENGTH_PROPS.has(key) ? `${value}px` : String(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (text === 'null' || text === 'undefined') return null;
  return text;
}

/** Collapse whitespace inside a CSS declaration list, keep `;` separated form. */
export function normalizeCss(css: string): string {
  return css
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/;\s*$/, '')
    .trim();
}

/** Convert a style map into a normalized `a: b; c: d` declaration list. */
export function styleToCss(map: StyleMap | undefined, omit?: Set<string>): string {
  if (!map) return '';
  const parts: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(map)) {
    if (rawKey.startsWith('_')) continue;
    const key = kebabCase(rawKey);
    if (NON_CSS_KEYS.has(key)) continue;
    if (omit?.has(key)) continue;
    const value = serializeValue(key, rawValue);
    if (value === null) continue;
    parts.push(`${key}: ${value}`);
  }
  return parts.join('; ');
}

/** Merge a style map into an existing declaration string; map wins. */
export function mergeStyle(existing: string | undefined, map: StyleMap | undefined): string {
  const base = (existing ?? '').trim();
  const extra = styleToCss(map);
  if (!extra) return normalizeCss(base);
  if (!base) return normalizeCss(extra);
  // Parse both sides so that a repeated property is replaced in place instead of
  // being appended (which would leave the older value in the declaration list).
  const merged = parseCss(base);
  for (const [key, value] of parseCss(extra)) merged.set(key, value);
  return [...merged.entries()].map(([key, value]) => `${key}: ${value}`).join('; ');
}

/** Parse a declaration list into a lower-cased key map (last value wins). */
export function parseCss(css: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!css) return out;
  for (const chunk of css.split(';')) {
    const index = chunk.indexOf(':');
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim().toLowerCase();
    const value = chunk.slice(index + 1).trim();
    if (key && value) out.set(key, value);
  }
  return out;
}

export function getCss(css: string | undefined, prop: string): string | undefined {
  return parseCss(css).get(prop.toLowerCase());
}

/** True when the declaration list sets a zero height (`height:0`, `0px`, `0em`). */
export function hasZeroHeight(css: string | undefined): boolean {
  const value = getCss(css, 'height');
  if (!value) return false;
  const first = value.split(/\s+/)[0] ?? '';
  return /^0(\.0+)?(px|em|rem|%|vh|vw|pt|pc|in|cm|mm)?$/.test(first);
}
