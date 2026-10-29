import {
  loadCatalog,
  loadModernIndex,
  localPathFor,
  type LoadedCatalog,
} from '@kiumi/catalog';
import { readFileSync } from 'node:fs';
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
  private svgCache = new Map<string, string | undefined>();
  private modernIndex?: TemplateIndexEntry[];

  constructor(options: KiumiClientOptions = {}) {
    this.dataDir = path.resolve(options.dataDir ?? process.env.KIUMI_DATA_DIR ?? './data');
  }

  private async loaded(): Promise<LoadedCatalog> {
    if (!this.loadedPromise) this.loadedPromise = loadCatalog(this.dataDir);
    return this.loadedPromise;
  }

  /** Modern tag-corpus groups, exposed as pseudo rooms (`modern:SVG`). */
  private async modern(): Promise<TemplateIndexEntry[]> {
    if (this.modernIndex) return this.modernIndex;
    const entries = await loadModernIndex(this.dataDir);
    this.modernIndex = entries.map((entry) => ({
      atomTplId: String(entry.atomTplId),
      displayName: String(entry.displayName ?? entry.atomTplId),
      room: `modern:${String(entry.room ?? 'other')}`,
      accessibility: String(entry.accessibility ?? 'Public'),
      hasSvg: Boolean(entry.hasSvg),
      hasAnimation: Boolean(entry.hasAnimation),
      byteSize: Number(entry.byteSize ?? 0),
      updatedAt: entry.updatedAt ? String(entry.updatedAt) : undefined,
    }));
    return this.modernIndex;
  }

  async rooms(filter: { house?: string; floor?: string } = {}): Promise<RoomInfo[]> {
    const catalog = await this.loaded();
    const legacy = catalog.rooms.filter(
      (room) =>
        (!filter.house || room.house === filter.house) &&
        (!filter.floor || room.floor === filter.floor),
    );
    const modern = await this.modern();
    const groups = new Map<string, number>();
    for (const entry of modern) {
      const group = entry.room.replace(/^modern:/, '');
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }
    const modernRooms: RoomInfo[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, count], index) => ({
        tag: `modern:${group}`,
        name: group,
        order: 900 + index,
        house: 'paper',
        floor: 'modern',
        count,
      }));
    return [...legacy, ...modernRooms];
  }

  async list(query: ListQuery = {}): Promise<{ items: TemplateIndexEntry[]; total: number }> {
    const catalog = await this.loaded();
    const needle = query.q?.trim().toLowerCase();
    const pool = query.room?.startsWith('modern:')
      ? await this.modern()
      : catalog.index;
    const filtered = pool.filter((entry) => {
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
    const file = `${slugOf(atomTplId)}.json`;
    const candidates = [
      path.join(catalog.paths.templates, file),
      path.join(catalog.paths.catalog, 'svg-anim', file),
      path.join(catalog.paths.catalog, 'modern', file),
    ];
    for (const candidate of candidates) {
      try {
        return JSON.parse(await readFile(candidate, 'utf8')) as TemplateRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return null;
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
    const modern = await this.modern();
    const loweredNeedle = needle.toLowerCase();
    const modernHits = modern.filter((entry) =>
      `${entry.displayName} ${entry.atomTplId}`.toLowerCase().includes(loweredNeedle),
    );
    const records = await this.allRecords();
    const hits: TemplateIndexEntry[] = [...modernHits.slice(0, limit)];
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

  /** Inline `.svg` stickers from the local mirror, mirroring upstream output. */
  private async svgOptions(): Promise<{ inlineSvg: (url: string) => string | undefined }> {
    const catalog = await this.loaded();
    const manifest = catalog.assetsManifest ?? {};
    const root = catalog.paths.assets;
    return {
      inlineSvg: (url: string) => {
        if (this.svgCache.has(url)) return this.svgCache.get(url);
        const normalized = url.startsWith('//')
          ? `https:${url}`
          : url.startsWith('http://')
            ? `https://${url.slice(7)}`
            : url;
        const entry = manifest[normalized] ?? manifest[url];
        // Fall back to the deterministic mirror path so inlining works while a
        // crawl is still running and the manifest has not been written yet.
        const candidates = [
          entry?.path ? path.join(root, entry.path) : null,
          normalized.startsWith('http') ? path.join(root, localPathFor(normalized)) : null,
        ].filter((value): value is string => Boolean(value));
        let text: string | undefined;
        for (const file of candidates) {
          try {
            text = readFileSync(file, 'utf8');
            break;
          } catch {
            text = undefined;
          }
        }
        this.svgCache.set(url, text);
        return text;
      },
    };
  }

  async render(matrix: unknown, skeletons?: Record<string, string>): Promise<RenderResult> {
    return renderMatrix(matrix, skeletons ?? (await this.skeletons()), await this.svgOptions());
  }

  async renderDocument(
    document: KiumiDocument,
    skeletons?: Record<string, string>,
  ): Promise<RenderResult> {
    const recorded = new Map<string, string>();
    for (const block of document.blocks) {
      if (block.kind !== 'library') continue;
      const record = await this.get(block.tplId);
      if (record) recorded.set(block.tplId, record.html);
    }
    return renderDocument(document, skeletons ?? (await this.skeletons()), {
      ...(await this.svgOptions()),
      recordedHtml: (tplId: string) => recorded.get(tplId),
    });
  }

  /**
   * Render a stored template. Some modern templates (SVG animation) synthesise
   * their markup inside xiumi's engine; the matrix alone cannot reproduce it,
   * so fall back to the recorded HTML rather than silently dropping the effect.
   */
  async renderRecord(record: TemplateRecord): Promise<RenderResult> {
    const result = await this.render(record.matrix);
    if (record.html.includes('<svg') && !result.html.includes('<svg')) {
      return {
        html: record.html,
        bytes: Buffer.byteLength(record.html, 'utf8'),
        warnings: [
          ...result.warnings,
          {
            code: 'SVG_ENGINE_FALLBACK',
            message:
              'template synthesises SVG at render time; served the recorded HTML instead of the matrix render',
          },
        ],
      };
    }
    return result;
  }

  async fill(atomTplId: string, set: Record<string, string>): Promise<FillResult> {
    const record = await this.get(atomTplId);
    if (!record) throw new Error(`TEMPLATE_NOT_FOUND: ${atomTplId}`);
    const matrix = fillMatrix(record.matrix, set);
    const result = await this.renderRecord(record);
    if (Object.keys(set).length && result.warnings.some((w) => w.code === 'SVG_ENGINE_FALLBACK')) {
      result.warnings.push({
        code: 'SLOT_OVERRIDE_IGNORED',
        message: 'slot overrides cannot be applied to a recorded-HTML fallback',
      });
    }
    if (record.room.startsWith('booklet-pg')) {
      result.warnings.push({
        code: 'H5_PAGE_UNSUPPORTED',
        message:
          'booklet-pg templates are H5 pages (layered swiper), not article bodies; output is archival only',
      });
    }
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

export { markdownToNodes, type MarkdownParseOptions } from './markdown.ts';
export {
  WeChatClient,
  WeChatError,
  ensureCoverMediaId,
  generateCoverPng,
  type WeChatConfig,
  type WeChatDraftArticle,
  type EnsureCoverOptions,
} from './wechat.ts';
export { DocumentBuilder as Document };
export type { KiumiDocument, RenderResult, TemplateRecord, RoomInfo, TemplateIndexEntry, Issue };
