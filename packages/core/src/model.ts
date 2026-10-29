import { KNOWN_CELL_TYPES } from './dsl.ts';
import type { Cell, CellType, Comp, CompMeta } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cellTypeOf(value: unknown): CellType | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (typeof type !== 'string') return null;
  return KNOWN_CELL_TYPES.has(type) ? (type as CellType) : 'unknown';
}

function normalizeCell(raw: unknown): Cell | null {
  const type = cellTypeOf(raw);
  if (!type || !isRecord(raw)) return null;
  const cell: Cell = { ...(raw as Record<string, unknown>), type };
  if (Array.isArray(raw.items)) {
    cell.items = raw.items
      .map((item) => normalizeComp(item))
      .filter((item): item is Comp => item !== null);
  }
  return cell;
}

/** Split a raw `{ _comp, <slot>: cell }` object into a typed `Comp`. */
export function normalizeComp(raw: unknown): Comp | null {
  if (Array.isArray(raw)) {
    // A bare array is a comp list, not a comp; callers should use normalizeMatrix.
    return null;
  }
  if (!isRecord(raw)) return null;
  const metaRaw = raw._comp;
  if (!isRecord(metaRaw)) return null;
  const tplId = typeof metaRaw.tplId === 'string' ? metaRaw.tplId : '';
  const meta: CompMeta = { ...(metaRaw as Record<string, unknown>), tplId };
  const slots: Record<string, Cell> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === '_comp') continue;
    const cell = normalizeCell(value);
    if (cell) slots[key] = cell;
  }
  return { meta, slots };
}

/** Accepts either a single comp object or an array of comps. */
export function normalizeMatrix(raw: unknown): Comp[] {
  if (raw === null || raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: Comp[] = [];
  for (const item of list) {
    const comp = normalizeComp(item);
    if (comp) out.push(comp);
  }
  return out;
}

/** Collect every `tplId` referenced by a comp tree (deduplicated, root first). */
export function collectTplIds(comps: Comp[], out: Set<string> = new Set()): Set<string> {
  for (const comp of comps) {
    if (comp.meta.tplId) out.add(comp.meta.tplId);
    for (const cell of Object.values(comp.slots)) {
      if (cell.items?.length) collectTplIds(cell.items, out);
    }
  }
  return out;
}

/** Depth-first walk over every comp in the tree. */
export function walkComps(comps: Comp[], visit: (comp: Comp, depth: number) => void, depth = 0): void {
  for (const comp of comps) {
    visit(comp, depth);
    for (const cell of Object.values(comp.slots)) {
      if (cell.items?.length) walkComps(cell.items, visit, depth + 1);
    }
  }
}

/**
 * Find the slot a user most likely wants to edit first: the first non-empty
 * text slot, else the first image slot, else the first slot key.
 */
export function primarySlot(comp: Comp): string | undefined {
  const entries = Object.entries(comp.slots);
  const text = entries.find(([, cell]) => cell.type === 'text' && (cell.text ?? '').trim());
  if (text) return text[0];
  const image = entries.find(([, cell]) => cell.type === 'image' && cell.src);
  if (image) return image[0];
  return entries[0]?.[0];
}

/** Set a dotted path on a nested cell, creating nothing that does not exist. */
export function setSlotValue(comp: Comp, slot: string, patch: Partial<Cell>): boolean {
  const cell = comp.slots[slot];
  if (!cell) return false;
  Object.assign(cell, patch);
  return true;
}
