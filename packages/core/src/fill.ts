/**
 * Slot filling for template matrices.
 *
 * Pure functions only: this module runs in Node, in the browser and in Workers,
 * so it must not touch the filesystem or any Node built-in.
 */

type RawComp = Record<string, unknown> & { _comp?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walk raw (un-normalized) comps so filling never rewrites the stored shape. */
function collectRawComps(matrix: unknown): RawComp[] {
  const out: RawComp[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 40 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    if (isRecord(value._comp)) {
      out.push(value as RawComp);
      for (const [key, child] of Object.entries(value)) {
        if (key === '_comp') continue;
        if (isRecord(child) && Array.isArray(child.items)) visit(child.items, depth + 1);
      }
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(matrix, 0);
  return out;
}

/**
 * Apply slot patches to a matrix without touching its original shape.
 * Keys accept `slot` or `slot.prop` (for example `img1.src`).
 */
export function fillMatrix(matrix: unknown, set: Record<string, string>): unknown {
  const cloned = structuredClone(matrix) as unknown;
  const comps = collectRawComps(cloned);
  for (const [key, value] of Object.entries(set)) {
    const dot = key.indexOf('.');
    const slot = dot > 0 ? key.slice(0, dot) : key;
    const prop = dot > 0 ? key.slice(dot + 1) : 'text';
    const target = comps.find((comp) => isRecord(comp[slot]));
    if (!target) continue;
    const cell = target[slot] as Record<string, unknown>;
    cell[prop] = value;
  }
  return cloned;
}
