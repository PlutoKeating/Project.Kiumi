export interface SlotInfo {
  /** Path usable as `slot` or `slot.prop` when patching. */
  path: string;
  slot: string;
  prop: 'text' | 'src';
  type: string;
  value: string;
  /** Stable DFS index of the owning component. */
  compIndex: number;
  /** `tplId#compIndex`, shown in the inspector. */
  label: string;
  tplId: string;
}

interface RawComp {
  _comp?: { tplId?: string };
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(matrix: unknown, visit: (comp: RawComp) => void, depth = 0): void {
  if (depth > 30 || matrix === null || matrix === undefined) return;
  if (Array.isArray(matrix)) {
    for (const item of matrix) walk(item, visit, depth + 1);
    return;
  }
  if (!isRecord(matrix)) return;
  if (isRecord(matrix._comp)) {
    visit(matrix as RawComp);
    for (const [key, child] of Object.entries(matrix)) {
      if (key === '_comp') continue;
      if (isRecord(child) && Array.isArray(child.items)) {
        walk(child.items, visit, depth + 1);
      }
    }
    return;
  }
  for (const child of Object.values(matrix)) walk(child, visit, depth + 1);
}

/** Enumerate editable slots across every component in a matrix. */
export function listSlots(matrix: unknown): SlotInfo[] {
  const out: SlotInfo[] = [];
  let order = 0;
  walk(matrix, (comp) => {
    const tplId = comp._comp?.tplId ?? '';
    const compIndex = order++;
    for (const [slot, cell] of Object.entries(comp)) {
      if (slot === '_comp' || !isRecord(cell)) continue;
      const type = String(cell.type ?? '');
      if (type === 'text') {
        out.push({
          path: slot,
          slot,
          prop: 'text',
          type,
          value: String(cell.text ?? ''),
          compIndex,
          label: `${slot} · #${compIndex}`,
          tplId,
        });
      } else if (type === 'image' || type === 'crop-image') {
        out.push({
          path: `${slot}.src`,
          slot,
          prop: 'src',
          type,
          value: String(cell.src ?? ''),
          compIndex,
          label: `${slot} · #${compIndex}`,
          tplId,
        });
      }
    }
  });
  return out;
}

/** Return a deep-cloned matrix with one slot patched. */
export function patchSlot(
  matrix: unknown,
  path: string,
  value: string,
  compIndex?: number,
): unknown {
  const clone = structuredClone(matrix) as unknown;
  const dot = path.indexOf('.');
  const slot = dot > 0 ? path.slice(0, dot) : path;
  const prop = dot > 0 ? path.slice(dot + 1) : 'text';

  let order = 0;
  let applied = false;
  walk(clone, (comp) => {
    const index = order++;
    if (applied) return;
    if (compIndex !== undefined && index !== compIndex) return;
    const cell = comp[slot];
    if (!isRecord(cell)) return;
    cell[prop] = value;
    applied = true;
  });
  return clone;
}

export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function toHtml(text: string): string {
  if (text.includes('<')) return text;
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `<p>${line}</p>`)
    .join('');
}
