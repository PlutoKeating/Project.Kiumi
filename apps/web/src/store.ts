import { create } from 'zustand';
import * as api from './api.ts';
import { patchSlot } from './lib/slots.ts';

export interface RoomGroup {
  key: string;
  label: string;
  rooms: string[];
}

/** UI grouping over the upstream rooms, mirroring how editors organise tabs. */
export const ROOM_GROUPS: RoomGroup[] = [
  { key: 'header', label: '标题', rooms: ['paper-cp:header'] },
  { key: 'card', label: '卡片', rooms: ['paper-cp:card'] },
  {
    key: 'image',
    label: '图片',
    rooms: ['paper-cp:image', 'paper-cp:multi-pic', 'paper-cp:layout-background'],
  },
  {
    key: 'layout',
    label: '布局',
    rooms: [
      'paper-cp:layout',
      'paper-cp:layout-samples',
      'paper-cp:table',
      'paper-cp:vertical-align',
      'paper-cp:slider',
    ],
  },
  {
    key: 'svg',
    label: 'SVG',
    rooms: ['paper-cp:SVG', 'paper-cp:sticker', 'paper-cp:element', 'paper-cp:separator-line'],
  },
  {
    key: 'widget',
    label: '组件',
    rooms: [
      'paper-cp:video',
      'paper-cp:chatbox',
      'paper-cp:form',
      'paper-cp:wechat',
      'paper-cp:namecard',
      'paper-cp:timeline',
      'paper-cp:top-bottom-guide',
      'paper-cp:sync-only',
    ],
  },
  { key: 'hot', label: '热门', rooms: ['paper-cp:recent'] },
];

const FAVORITES_KEY = 'kiumi:favorites';
const RECENT_KEY = 'kiumi:recent';
const CLIPBOARD_KEY = 'kiumi:clipboard';

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: favourites/clipboard are a convenience, not state
  }
}

function emptyDoc(): api.Document {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: `local-${Date.now().toString(36)}`,
    title: '未命名图文',
    blocks: [],
    meta: { createdAt: now, updatedAt: now },
  };
}

let previewToken = 0;

interface State {
  ready: boolean;
  rooms: api.Room[];
  templates: api.TemplateIndexEntry[];
  activeGroup: string;
  activeRoom: string | null;
  query: string;
  loading: boolean;
  offset: number;
  view: 'recommend' | 'recent';
  recent: { id: string; name: string }[];
  zoom: number;
  doc: api.Document;
  past: api.Document[];
  future: api.Document[];
  selected: number | null;
  previews: Record<string, string>;
  issues: api.Issue[];
  message: string;
  favorites: string[];
  clipboard: api.Block[];

  boot: () => Promise<void>;
  setGroup: (key: string) => void;
  setRoom: (tag: string | null) => void;
  setQuery: (value: string) => void;
  setView: (view: 'recommend' | 'recent') => void;
  shuffle: () => void;
  setZoom: (zoom: number) => void;
  reloadTemplates: () => Promise<void>;
  insertTemplate: (atomTplId: string) => Promise<void>;
  addNative: (kind: api.NativeNode['kind']) => void;
  select: (index: number | null) => void;
  setTitle: (title: string) => void;
  setDigest: (digest: string) => void;
  updateSlot: (index: number, path: string, value: string, compIndex?: number) => void;
  updateNative: (index: number, patch: Partial<api.NativeNode>) => void;
  addImageBlock: (src: string) => void;
  removeBlock: (index: number) => void;
  moveBlock: (from: number, to: number) => void;
  refresh: () => Promise<void>;
  save: () => Promise<void>;
  newDoc: () => void;
  undo: () => void;
  redo: () => void;
  commit: (next: api.Document) => void;
  toggleFavorite: (atomTplId: string) => void;
  copyBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  insertClipboard: (clipIndex: number, at?: number) => void;
  clearClipboard: () => void;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  rooms: [],
  templates: [],
  activeGroup: 'header',
  activeRoom: 'paper-cp:header',
  query: '',
  loading: false,
  offset: 0,
  view: 'recommend',
  recent: [],
  zoom: 100,
  doc: emptyDoc(),
  past: [],
  future: [],
  selected: null,
  previews: {},
  issues: [],
  message: '',
  favorites: [],
  clipboard: [],

  async boot() {
    set({
      favorites: readLocal<string[]>(FAVORITES_KEY, []),
      clipboard: readLocal<api.Block[]>(CLIPBOARD_KEY, []),
      recent: readLocal<{ id: string; name: string }[]>(RECENT_KEY, []),
    });
    try {
      const rooms = await api.fetchRooms();
      set({ rooms, ready: true });
      await get().reloadTemplates();
    } catch (error) {
      set({ message: `加载失败：${(error as Error).message}` });
    }
  },

  setGroup(key) {
    const group = ROOM_GROUPS.find((item) => item.key === key);
    const first = group?.rooms.find((room) => get().rooms.some((entry) => entry.tag === room));
    set({ activeGroup: key, activeRoom: first ?? null });
    void get().reloadTemplates();
  },

  setRoom(tag) {
    set({ activeRoom: tag });
    void get().reloadTemplates();
  },

  setQuery(value) {
    set({ query: value, offset: 0 });
    void get().reloadTemplates();
  },

  setView(view) {
    set({ view, offset: 0 });
    if (view === 'recommend') void get().reloadTemplates();
  },

  shuffle() {
    set({ offset: get().offset + 60 });
    void get().reloadTemplates();
  },

  setZoom(zoom) {
    set({ zoom: Math.min(140, Math.max(50, zoom)) });
  },

  async reloadTemplates() {
    const { activeRoom, query, offset, view, recent } = get();
    if (view === 'recent') {
      set({ loading: false });
      return;
    }
    set({ loading: true });
    try {
      const templates = await api.fetchTemplates({
        room: activeRoom ?? undefined,
        q: query || undefined,
        limit: 60,
        offset,
      });
      // A shuffle past the end wraps to the first page.
      if (!templates.length && offset > 0) {
        set({ offset: 0 });
        void get().reloadTemplates();
        return;
      }
      void recent;
      set({ templates, loading: false });
    } catch (error) {
      set({ loading: false, message: `模板加载失败：${(error as Error).message}` });
    }
  },

  async insertTemplate(atomTplId) {
    try {
      const record = await api.fetchTemplate(atomTplId);
      const doc = get().doc;
      const block: api.LibraryBlock = {
        kind: 'library',
        id: `blk-${Date.now().toString(36)}`,
        tplId: record.atomTplId,
        matrix: record.matrix,
      };
      const current = get().selected;
      const index = current === null ? doc.blocks.length : current + 1;
      const blocks = [...doc.blocks];
      blocks.splice(index, 0, block);
      get().commit({ ...doc, blocks });
      const recent = [
        { id: record.atomTplId, name: record.displayName },
        ...get().recent.filter((item) => item.id !== record.atomTplId),
      ].slice(0, 24);
      writeLocal(RECENT_KEY, recent);
      set({ selected: index, recent, message: `已插入 ${record.displayName}` });
      await get().refresh();
    } catch (error) {
      set({ message: `插入失败：${(error as Error).message}` });
    }
  },

  addNative(kind) {
    const doc = get().doc;
    const node: api.NativeNode =
      kind === 'heading'
        ? { kind, text: '标题', level: 2 }
        : kind === 'divider'
          ? { kind }
          : kind === 'spacer'
            ? { kind, height: 16 }
            : { kind, text: '在这里输入正文' };
    const block: api.NativeBlock = {
      kind: 'native',
      id: `blk-${Date.now().toString(36)}`,
      node,
    };
    get().commit({ ...doc, blocks: [...doc.blocks, block] });
    set({ selected: doc.blocks.length });
    void get().refresh();
  },

  select(index) {
    set({ selected: index });
  },

  setTitle(title) {
    set({ doc: { ...get().doc, title } });
  },

  setDigest(digest) {
    const doc = get().doc;
    set({ doc: { ...doc, meta: { ...doc.meta, digest } } });
  },

  updateSlot(index, path, value, compIndex) {
    const doc = get().doc;
    const block = doc.blocks[index];
    if (!block || block.kind !== 'library') return;
    const matrix = patchSlot(block.matrix, path, value, compIndex);
    const blocks = [...doc.blocks];
    blocks[index] = { ...block, matrix };
    get().commit({ ...doc, blocks });
    void get().refresh();
  },

  updateNative(index, patch) {
    const doc = get().doc;
    const block = doc.blocks[index];
    if (!block || block.kind !== 'native') return;
    const blocks = [...doc.blocks];
    blocks[index] = { ...block, node: { ...block.node, ...patch } };
    get().commit({ ...doc, blocks });
    void get().refresh();
  },

  addImageBlock(src) {
    const doc = get().doc;
    const block: api.NativeBlock = {
      kind: 'native',
      id: `blk-${Date.now().toString(36)}`,
      node: { kind: 'image', src },
    };
    get().commit({ ...doc, blocks: [...doc.blocks, block] });
    set({ selected: doc.blocks.length });
    void get().refresh();
  },

  removeBlock(index) {
    const doc = get().doc;
    const blocks = doc.blocks.filter((_, position) => position !== index);
    get().commit({ ...doc, blocks });
    set({ selected: null });
    void get().refresh();
  },

  moveBlock(from, to) {
    const doc = get().doc;
    if (from === to || from < 0 || to < 0 || from >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    const [moved] = blocks.splice(from, 1);
    if (!moved) return;
    blocks.splice(Math.min(to, blocks.length), 0, moved);
    get().commit({ ...doc, blocks });
    set({ selected: to });
  },

  commit(next) {
    const { doc, past } = get();
    if (JSON.stringify(next.blocks) === JSON.stringify(doc.blocks) && next.title === doc.title) return;
    set({ past: [...past.slice(-49), doc], future: [] });
    set({ doc: { ...next, meta: { ...next.meta, updatedAt: new Date().toISOString() } } });
  },

  undo() {
    const { past, future, doc } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    set({ past: past.slice(0, -1), future: [doc, ...future].slice(0, 50), doc: previous, selected: null });
    void get().refresh();
  },

  redo() {
    const { past, future, doc } = get();
    const next = future[0];
    if (!next) return;
    set({ past: [...past, doc].slice(-50), future: future.slice(1), doc: next, selected: null });
    void get().refresh();
  },

  async refresh() {
    const { doc } = get();
    const token = ++previewToken;
    const previews: Record<string, string> = {};
    const issues: api.Issue[] = [];
    for (const block of doc.blocks) {
      try {
        const result = await api.renderBlock(block, doc);
        previews[block.id] = result.html;
        issues.push(...result.issues.map((issue) => ({ ...issue, selector: block.id })));
      } catch (error) {
        previews[block.id] = `<p style="color:#c33">渲染失败：${(error as Error).message}</p>`;
      }
    }
    if (token === previewToken) set({ previews, issues });
  },

  async save() {
    const doc = get().doc;
    try {
      if (doc.id.startsWith('local-')) {
        const created = await api.createDocument(doc.title);
        const merged: api.Document = { ...doc, id: created.id, meta: created.meta };
        await api.saveDocument(merged);
        set({ doc: merged, message: '已保存' });
      } else {
        const saved = await api.saveDocument(doc);
        set({ doc: { ...doc, meta: saved.meta }, message: '已保存' });
      }
    } catch (error) {
      set({ message: `保存失败：${(error as Error).message}` });
    }
  },

  toggleFavorite(atomTplId) {
    const favorites = get().favorites.includes(atomTplId)
      ? get().favorites.filter((id) => id !== atomTplId)
      : [atomTplId, ...get().favorites];
    writeLocal(FAVORITES_KEY, favorites);
    set({
      favorites,
      message: favorites.includes(atomTplId) ? '已收藏' : '已取消收藏',
    });
  },

  duplicateBlock(index) {
    const doc = get().doc;
    const block = doc.blocks[index];
    if (!block) return;
    const clone: api.Block = {
      ...structuredClone(block),
      id: `blk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    };
    const blocks = [...doc.blocks];
    blocks.splice(index + 1, 0, clone);
    get().commit({ ...doc, blocks });
    set({ selected: index + 1, message: '已原地复制' });
    void get().refresh();
  },

  copyBlock(index) {
    const block = get().doc.blocks[index];
    if (!block) return;
    const clipboard = [structuredClone(block), ...get().clipboard].slice(0, 30);
    writeLocal(CLIPBOARD_KEY, clipboard);
    set({ clipboard, message: '已复制到剪贴板' });
  },

  insertClipboard(clipIndex, at) {
    const source = get().clipboard[clipIndex];
    if (!source) return;
    const doc = get().doc;
    const clone: api.Block = {
      ...structuredClone(source),
      id: `blk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    };
    const blocks = [...doc.blocks];
    const index = at === undefined ? blocks.length : at;
    blocks.splice(index, 0, clone);
    get().commit({ ...doc, blocks });
    set({ selected: index, message: '已粘贴' });
    void get().refresh();
  },

  clearClipboard() {
    writeLocal(CLIPBOARD_KEY, []);
    set({ clipboard: [], message: '剪贴板已清空' });
  },

  newDoc() {
    const { doc, past } = get();
    set({
      past: [...past.slice(-49), doc],
      future: [],
      doc: emptyDoc(),
      selected: null,
      previews: {},
      issues: [],
      message: '已新建',
    });
  },
}));
