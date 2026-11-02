import type { Block, KiumiDocument } from './types.ts';

/**
 * Document operations shared by the Worker (MCP tools, REST) and the browser.
 * An Agent edits through ops; the browser receives the same ops and applies
 * them to its local copy, so a change shows up on the canvas without a reload.
 * All ops address blocks by id, which makes them mergeable with local edits.
 */
export type DocOp =
  | { op: 'title'; title: string }
  | { op: 'meta'; meta: Partial<KiumiDocument['meta']> }
  | { op: 'insert'; blocks: Block[]; /** index, 'end', or place after this block id */ at?: number | 'end' | { after: string } }
  | { op: 'replace'; id: string; block: Block }
  | { op: 'html'; id: string; html: string }
  | { op: 'remove'; ids: string[] }
  | { op: 'move'; id: string; to: number }
  | { op: 'set'; blocks: Block[]; title?: string; meta?: Partial<KiumiDocument['meta']> };

export interface OpResult {
  doc: KiumiDocument;
  errors: string[];
}

export function applyOps(source: KiumiDocument, ops: DocOp[]): OpResult {
  let doc: KiumiDocument = { ...source, blocks: [...source.blocks], meta: { ...source.meta } };
  const errors: string[] = [];
  const indexOf = (id: string) => doc.blocks.findIndex(b => b.id === id);
  for (const op of ops) {
    switch (op.op) {
      case 'title':
        if (typeof op.title === 'string' && op.title.trim()) doc.title = op.title.trim().slice(0, 200);
        else errors.push('title: 标题不能为空');
        break;
      case 'meta':
        doc.meta = { ...doc.meta, ...op.meta };
        break;
      case 'insert': {
        const at = op.at === undefined || op.at === 'end' ? doc.blocks.length : typeof op.at === 'number' ? Math.max(0, Math.min(op.at, doc.blocks.length)) : indexOf(op.at.after) + 1;
        if (typeof op.at === 'object' && op.at && indexOf(op.at.after) < 0) { errors.push(`insert: 找不到块 ${op.at.after}`); break; }
        doc.blocks.splice(at, 0, ...op.blocks);
        break;
      }
      case 'replace': {
        const i = indexOf(op.id);
        if (i < 0) errors.push(`replace: 找不到块 ${op.id}`); else doc.blocks[i] = { ...op.block, id: op.id } as Block;
        break;
      }
      case 'html': {
        const i = indexOf(op.id);
        const block = doc.blocks[i];
        if (!block) errors.push(`html: 找不到块 ${op.id}`);
        else if (block.kind !== 'library') errors.push(`html: 块 ${op.id} 不是 HTML 块`);
        else doc.blocks[i] = { ...block, html: op.html };
        break;
      }
      case 'remove': {
        const ids = new Set(op.ids);
        const before = doc.blocks.length;
        doc.blocks = doc.blocks.filter(b => !ids.has(b.id));
        if (before - doc.blocks.length !== ids.size) errors.push('remove: 部分块不存在');
        break;
      }
      case 'move': {
        const from = indexOf(op.id);
        if (from < 0) { errors.push(`move: 找不到块 ${op.id}`); break; }
        const [block] = doc.blocks.splice(from, 1);
        doc.blocks.splice(Math.max(0, Math.min(op.to, doc.blocks.length)), 0, block);
        break;
      }
      case 'set':
        doc.blocks = [...op.blocks];
        if (op.title) doc.title = op.title.slice(0, 200);
        if (op.meta) doc.meta = { ...doc.meta, ...op.meta };
        break;
      default:
        errors.push(`未知操作 ${(op as { op?: string }).op}`);
    }
  }
  return { doc, errors };
}

/** Structural check for ops coming from the network. */
export function validateOps(value: unknown): DocOp[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('操作列表格式不正确');
  const blockOk = (b: any) => b && typeof b.id === 'string' && ['library', 'native'].includes(b.kind);
  for (const op of value as any[]) {
    if (!op || typeof op.op !== 'string') throw new Error('操作缺少 op');
    if (op.op === 'insert' && !(Array.isArray(op.blocks) && op.blocks.every(blockOk))) throw new Error('insert 的块格式不正确');
    if (op.op === 'set' && !(Array.isArray(op.blocks) && op.blocks.length <= 500 && op.blocks.every(blockOk))) throw new Error('set 的块格式不正确');
    if (op.op === 'replace' && !(typeof op.id === 'string' && blockOk(op.block))) throw new Error('replace 格式不正确');
    if (op.op === 'remove' && !(Array.isArray(op.ids) && op.ids.every((i: unknown) => typeof i === 'string'))) throw new Error('remove 格式不正确');
  }
  return value as DocOp[];
}
