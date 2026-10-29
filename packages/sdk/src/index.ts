import {
  loadCatalog,
  type LoadedCatalog,
} from '@kiumi/catalog';
import {
  normalizeMatrix,
  primarySlot,
  renderDocument,
  renderMatrix,
  validateHtml,
  type Block,
  type Issue,
  type KiumiDocument,
  type NativeNode,
  type RenderResult,
  type RoomInfo,
  type TemplateIndexEntry,
  type TemplateRecord,
  type ValidateOptions,
} from '@kiumi/core';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { slugOf } from '@kiumi/catalog';

export interface KiumiClientOptions {
  /** Directory holding `catalog/`, `assets/`, `uploads/`. */
  dataDir?: string;
}

export interface ListQuery {
  room?: string;
  q?: string;
  hasSvg?: boolean;
  accessibility?: string;
  limit?: number;
  offset?: number;
}

export interface FillResult {
  matrix: unknown;
  html: string;
  warnings: RenderResult['warnings'];
}

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

/** Fluent builder for a document made of library and native blocks. */
export class DocumentBuilder {
  readonly doc: KiumiDocument;

  private constructor(doc: KiumiDocument) {
    this.doc = doc;
  }

  static create(title: string, id?: string): DocumentBuilder {
    const now = new Date().toISOString();
    return new DocumentBuilder({
      version: 1,
      id: id ?? `doc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      title,
      blocks: [],
      meta: { createdAt: now, updatedAt: now },
    });
  }

  static fromJSON(doc: KiumiDocument): DocumentBuilder {
    return new DocumentBuilder(doc);
  }

  addLibraryBlock(record: Pick<TemplateRecord, 'atomTplId' | 'matrix'>, index?: number): this {
    return this.insert(
      {
        kind: 'library',
        id: `blk_${Math.random().toString(36).slice(2, 10)}`,
        tplId: record.atomTplId,
        matrix: structuredClone(record.matrix),
      },
      index,
    );
  }

  addNativeBlock(node: NativeNode, index?: number): this {
    return this.insert(
      {
        kind: 'native',
        id: `blk_${Math.random().toString(36).slice(2, 10)}`,
        node,
      },
      index,
    );
  }

  private insert(block: Block, index?: number): this {
    if (index === undefined || index < 0 || index >= this.doc.blocks.length) {
      this.doc.blocks.push(block);
    } else {
      this.doc.blocks.splice(index, 0, block);
    }
    this.touch();
    return this;
  }

  fillBlock(blockIndex: number, set: Record<string, string>): this {
    const block = this.doc.blocks[blockIndex];
    if (!block || block.kind !== 'library') return this;
    block.matrix = fillMatrix(block.matrix, set);
    this.touch();
    return this;
  }

  removeBlock(blockIndex: number): this {
    if (blockIndex >= 0 && blockIndex < this.doc.blocks.length) {
      this.doc.blocks.splice(blockIndex, 1);
      this.touch();
    }
    return this;
  }

  toJSON(): KiumiDocument {
    return this.doc;
  }

  private touch(): void {
    this.doc.meta.updatedAt = new Date().toISOString();
  }
}

/** Facade shared by the CLI, the MCP server and the HTTP service. */
export class KiumiClient {
  readonly dataDir: string;
  private loadedPromise?: Promise<LoadedCatalog>;
  private deepRecords?: Map<string, TemplateRecord>;

  constructor(options: KiumiClientOptions = {}) {
    this.dataDir = path.resolve(options.dataDir ?? process.env.KIUMI_DATA_DIR ?? './data');
  }

  private async loaded(): Promise<LoadedCatalog> {
    if (!this.loadedPromise) this.loadedPromise = loadCatalog(this.dataDir);
    return this.loadedPromise;
  }

  async rooms(filter: { house?: string; floor?: string } = {}): Promise<RoomInfo[]> {
    const catalog = await this.loaded();
    return catalog.rooms.filter(
      (room) =>
        (!filter.house || room.house === filter.house) &&
        (!filter.floor || room.floor === filter.floor),
    );
  }

  async list(query: ListQuery = {}): Promise<{ items: TemplateIndexEntry[]; total: number }> {
    const catalog = await this.loaded();
    const needle = query.q?.trim().toLowerCase();
    const filtered = catalog.index.filter((entry) => {
      if (query.room && entry.room !== query.room) return false;
      if (query.accessibility && entry.accessibility !== query.accessibility) return false;
      if (query.hasSvg !== undefined && entry.hasSvg !== query.hasSvg) return false;
      if (needle) {
        const haystack = `${entry.displayName} ${entry.atomTplId}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  }

  async get(atomTplId: string): Promise<TemplateRecord | null> {
    const catalog = await this.loaded();
    const file = path.join(catalog.paths.templates, `${slugOf(atomTplId)}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as TemplateRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async allRecords(): Promise<Map<string, TemplateRecord>> {
    if (this.deepRecords) return this.deepRecords;
    const catalog = await this.loaded();
    const map = new Map<string, TemplateRecord>();
    for (const entry of catalog.index) {
      const record = await this.get(entry.atomTplId);
      if (record) map.set(record.atomTplId, record);
    }
    this.deepRecords = map;
    return map;
  }

  /** Full-text search across rendered HTML, slower than `list`. */
  async search(text: string, limit = 20): Promise<TemplateIndexEntry[]> {
    const needle = text.trim();
    if (!needle) return [];
    const records = await this.allRecords();
    const hits: TemplateIndexEntry[] = [];
    const lowered = needle.toLowerCase();
    for (const record of records.values()) {
      if (hits.length >= limit) break;
      const nameHit = `${record.displayName} ${record.atomTplId}`.toLowerCase().includes(lowered);
      const bodyHit = record.html.toLowerCase().includes(lowered);
      if (nameHit || bodyHit) {
        hits.push({
          atomTplId: record.atomTplId,
          displayName: record.displayName,
          room: record.room,
          accessibility: record.accessibility,
          hasSvg: record.hasSvg,
          hasAnimation: record.hasAnimation,
          byteSize: record.byteSize,
          updatedAt: record.updatedAt,
        });
      }
    }
    return hits;
  }

  async skeletons(): Promise<Record<string, string>> {
    return (await this.loaded()).skeletons;
  }

  async render(matrix: unknown, skeletons?: Record<string, string>): Promise<RenderResult> {
    return renderMatrix(matrix, skeletons ?? (await this.skeletons()));
  }

  async renderDocument(
    document: KiumiDocument,
    skeletons?: Record<string, string>,
  ): Promise<RenderResult> {
    return renderDocument(document, skeletons ?? (await this.skeletons()));
  }

  async fill(atomTplId: string, set: Record<string, string>): Promise<FillResult> {
    const record = await this.get(atomTplId);
    if (!record) throw new Error(`TEMPLATE_NOT_FOUND: ${atomTplId}`);
    const matrix = fillMatrix(record.matrix, set);
    const result = await this.render(matrix);
    return { matrix, html: result.html, warnings: result.warnings };
  }

  validate(html: string, options?: ValidateOptions): Issue[] {
    return validateHtml(html, options);
  }

  /** Slots available on the first component of a template, for tooling hints. */
  async slots(atomTplId: string): Promise<string[]> {
    const record = await this.get(atomTplId);
    if (!record) return [];
    const comps = normalizeMatrix(record.matrix);
    const first = comps[0];
    if (!first) return [];
    const primary = primarySlot(first);
    return Object.keys(first.slots).sort((a, b) => (a === primary ? -1 : b === primary ? 1 : 0));
  }
}

export interface DocumentSummary {
  id: string;
  title: string;
  blocks: number;
  updatedAt: string;
}

/** Documents live as one JSON file per id under `<dataDir>/documents`. */
export class FileDocumentStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(path.resolve(dataDir), 'documents');
  }

  private fileOf(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`INVALID_DOCUMENT_ID: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async create(title: string): Promise<KiumiDocument> {
    const doc = DocumentBuilder.create(title).toJSON();
    await this.put(doc);
    return doc;
  }

  async get(id: string): Promise<KiumiDocument | null> {
    try {
      return JSON.parse(await readFile(this.fileOf(id), 'utf8')) as KiumiDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(doc: KiumiDocument): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.fileOf(doc.id), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  async delete(id: string): Promise<boolean> {
    try {
      await unlink(this.fileOf(id));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async list(): Promise<DocumentSummary[]> {
    try {
      const files = await readdir(this.dir);
      const out: DocumentSummary[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const doc = await this.get(file.replace(/\.json$/, ''));
        if (!doc) continue;
        out.push({
          id: doc.id,
          title: doc.title,
          blocks: doc.blocks.length,
          updatedAt: doc.meta.updatedAt,
        });
      }
      return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}

export function createKiumi(options: KiumiClientOptions = {}): KiumiClient {
  return new KiumiClient(options);
}

export { DocumentBuilder as Document };
export type { KiumiDocument, RenderResult, TemplateRecord, RoomInfo, TemplateIndexEntry, Issue };
