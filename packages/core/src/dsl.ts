import type { Cell, Comp, CompAux, CompMeta } from './types.ts';

/**
 * The template DSL found on upstream skeletons.
 * These attributes are instructions to the *editor*, not CSS; the renderer
 * resolves them into inline styles or drops them.
 */
export const ATTR = {
  cellType: 'tn-cell-type',
  bindCell: 'tn-bind-cell',
  bindAuxProp: 'tn-bind-aux-prop',
  subCompLoader: 'tn-sub-comp-loader',
  childPosition: 'tn-child-position',
  childOrientation: 'tn-child-orientation',
  horizontalLayoutWidth: 'tn-horizontal-layout-width',
  style: 'tn-style',
  video: 'tn-video',
  miniProgram: 'tn-mini-program',
  svgAnimation: 'tn-svg-animation',
  svgAnimationStyle: 'tn-svg-animation-style',
  svgAnimationCarousel: 'tn-svg-animation-carousel',
  groupUsage: 'tn-group-usage',
  containerUsage: 'tn-container-usage',
  groupAuxHorizontal: 'tn-group-aux-horizontal',
  groupAuxVertical: 'tn-group-aux-vertical',
  groupVerticalBoxMask: 'tn-group-vertical-box-mask',
  richTextContent: 'tn-rich-text-content',
  sortablePin: 'tn-sortable-pin',
  radioCaption: 'tn-input-radio-caption',
  checkboxCaption: 'tn-input-checkbox-caption',
} as const;

export const KNOWN_CELL_TYPES = new Set([
  'text',
  'group',
  'image',
  'crop-image',
  'video',
  'shape',
  'table',
  'container',
]);

/** Cell types that behave like a single image slot. */
export const IMAGE_CELL_TYPES = new Set(['image', 'crop-image']);

/** Cell types that host children. `table` cells mount rows the same way. */
export const CONTAINER_CELL_TYPES = new Set(['group', 'container', 'table']);

/** `demo:header/t-a-01` -> `paper-cp` */
export function houseOf(tplId: string): string {
  const colon = tplId.indexOf(':');
  return colon > 0 ? tplId.slice(0, colon) : 'paper-cp';
}

/** `demo:header/t-a-01` -> `paper-cp/header/t-a-01-01` */
export function tplIdToPath(tplId: string): string {
  return tplId.replace(':', '/');
}

// ---------------------------------------------------------------------------
// Aux binding expressions
// ---------------------------------------------------------------------------

export interface AuxBinding {
  /** CSS property name as written in the template, e.g. `backgroundColor`. */
  prop: string;
  /** Right-hand expression, e.g. `compAux.titleBgc` or `cell.constraint.childAlign`. */
  expr: string;
}

/**
 * Parse `{ backgroundColor: compAux.titleBgc, color: cell.style.color }`.
 * The syntax upstream uses is a JavaScript object literal without quotes, so a
 * forgiving scanner is safer than JSON.parse.
 */
export function parseAuxBindings(spec: string | undefined): AuxBinding[] {
  if (!spec) return [];
  let body = spec.trim();
  if (body.startsWith('{') && body.endsWith('}')) body = body.slice(1, -1);
  const out: AuxBinding[] = [];
  for (const rawChunk of splitTopLevel(body)) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;
    const index = chunk.indexOf(':');
    if (index < 0) continue;
    let key = chunk.slice(0, index).trim();
    const expr = chunk.slice(index + 1).trim();
    if (
      (key.startsWith("'") && key.endsWith("'")) ||
      (key.startsWith('"') && key.endsWith('"'))
    ) {
      key = key.slice(1, -1);
    }
    if (key && expr) out.push({ prop: key, expr });
  }
  return out;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '{' || char === '(' || char === '[') depth++;
    if (char === '}' || char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function readPath(source: unknown, path: string[]): unknown {
  let value: unknown = source;
  for (const key of path) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export interface AuxContext {
  aux?: CompAux;
  cell?: Cell;
  meta?: CompMeta;
}

/** Evaluate one aux expression against the current component/cell. */
export function evalAuxExpr(expr: string, ctx: AuxContext): string | undefined {
  const text = expr.trim();
  if (!text) return undefined;

  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    return text.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;

  if (text.startsWith('compAux.')) {
    const path = text.slice('compAux.'.length).split('.');
    const entry = readPath(ctx.aux, path);
    if (entry && typeof entry === 'object' && 'value' in (entry as object)) {
      const value = (entry as { value?: unknown }).value;
      return value === null || value === undefined ? undefined : String(value);
    }
    return entry === null || entry === undefined ? undefined : String(entry);
  }

  if (text.startsWith('cell.')) {
    const path = text.slice('cell.'.length).split('.');
    const value = readPath(ctx.cell, path);
    return value === null || value === undefined ? undefined : String(value);
  }

  if (text.startsWith('comp.')) {
    const path = text.slice('comp.'.length).split('.');
    const value = readPath(ctx.meta, path);
    return value === null || value === undefined ? undefined : String(value);
  }

  return undefined;
}

/** Resolve a whole binding list into a style map. */
export function resolveAuxBindings(spec: string | undefined, ctx: AuxContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { prop, expr } of parseAuxBindings(spec)) {
    const value = evalAuxExpr(expr, ctx);
    if (value !== undefined && value !== '') out[prop] = value;
  }
  return out;
}

/** True when a comp has at least one slot carrying real content. */
export function isEmptyComp(comp: Comp): boolean {
  const cells = Object.values(comp.slots);
  if (!cells.length) return true;
  return cells.every((cell) => {
    if (cell.type === 'group') return !(cell.items ?? []).length;
    if (cell.type === 'text') return !(cell.text ?? '').trim();
    if (cell.type === 'image') return !cell.src;
    return false;
  });
}
