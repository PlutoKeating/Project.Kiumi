/**
 * Theme recolouring.
 *
 * Upstream templates declare their tint colours in `_comp.aux` (designer slots)
 * and repeat them in cell styles. We recolour both, but only values that match
 * one of the declared aux colours — arbitrary colours (text black, photos) are
 * left alone so the design does not collapse.
 */

type StyleMap = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const COLOR_PROPS = new Set(['color', 'backgroundcolor', 'bordercolor', 'border-left-color', 'border-right-color', 'border-top-color', 'border-bottom-color']);

function normalizeColor(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

/** Aux colours live in `_comp.aux` in the stored matrix. */
function auxOf(node: Record<string, unknown>): Record<string, unknown> | null {
  const direct = node.aux;
  if (isRecord(direct)) return direct;
  const meta = node._comp;
  if (isRecord(meta) && isRecord(meta.aux)) return meta.aux;
  return null;
}

function collectAuxColors(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 40) return;
  if (Array.isArray(node)) {
    for (const item of node) collectAuxColors(item, out, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  const aux = auxOf(node);
  if (aux) {
    for (const entry of Object.values(aux)) {
      if (isRecord(entry) && typeof entry.value === 'string') {
        const value = normalizeColor(entry.value);
        if (value && value !== 'transparent' && value !== 'none') out.add(value);
      }
    }
  }
  for (const value of Object.values(node)) collectAuxColors(value, out, depth + 1);
}

function recolorStyles(node: unknown, targets: Set<string>, color: string, depth = 0): void {
  if (depth > 60) return;
  if (Array.isArray(node)) {
    for (const item of node) recolorStyles(item, targets, color, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  const style = node.style;
  if (isRecord(style)) {
    for (const [key, value] of Object.entries(style)) {
      if (typeof value !== 'string') continue;
      if (!COLOR_PROPS.has(key.toLowerCase())) continue;
      if (targets.has(normalizeColor(value))) style[key] = color;
    }
  }
  for (const value of Object.values(node)) recolorStyles(value, targets, color, depth + 1);
}

function recolorAux(node: unknown, color: string, depth = 0): void {
  if (depth > 40) return;
  if (Array.isArray(node)) {
    for (const item of node) recolorAux(item, color, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  const aux = auxOf(node);
  if (aux) {
    for (const entry of Object.values(aux)) {
      if (!isRecord(entry) || entry.type !== 'color') continue;
      const value = normalizeColor(String(entry.value ?? ''));
      if (value === 'transparent' || value === 'none') continue;
      entry.value = color;
    }
  }
  for (const value of Object.values(node)) recolorAux(value, color, depth + 1);
}

/** Return a recoloured copy of a template matrix. */
export function applyThemeColor(matrix: unknown, color: string): unknown {
  const clone = structuredClone(matrix) as unknown;
  const targets = new Set<string>();
  collectAuxColors(clone, targets);
  if (!targets.size) return clone;
  recolorStyles(clone, targets, color);
  recolorAux(clone, color);
  return clone;
}

/** True when the template declares at least one tint colour. */
export function hasThemeColors(matrix: unknown): boolean {
  const set = new Set<string>();
  collectAuxColors(matrix, set);
  return set.size > 0;
}
