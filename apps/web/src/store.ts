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
  doc: api.Document;
  selected: number | null;
  previews: Record<string, string>;
  issues: api.Issue[];
  message: string;

  boot: () => Promise<void>;
  setGroup: (key: string) => void;
  setRoom: (tag: string | null) => void;
  setQuery: (value: string) => void;
  reloadTemplates: () => Promise<void>;
  insertTemplate: (atomTplId: string) => Promise<void>;
  addNative: (kind: api.NativeNode['kind']) => void;
  select: (index: number | null) => void;
  setTitle: (title: string) => void;
  updateSlot: (index: number, path: string, value: string) => void;
  updateNative: (index: number, patch: Partial<api.NativeNode>) => void;
  addImageBlock: (src: string) => void;
  removeBlock: (index: number) => void;
  moveBlock: (from: number, to: number) => void;
  refresh: () => Promise<void>;
  save: () => Promise<void>;
  newDoc: () => void;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  rooms: [],
  templates: [],
  activeGroup: 'header',
  activeRoom: 'paper-cp:header',
  query: '',
  loading: false,
  doc: emptyDoc(),
  selected: null,
  previews: {},
  issues: [],
  message: '',

  async boot() {
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
    set({ query: value });
    void get().reloadTemplates();
  },

  async reloadTemplates() {
    const { activeRoom, query } = get();
    set({ loading: true });
    try {
      const templates = await api.fetchTemplates({
        room: activeRoom ?? undefined,
        q: query || undefined,
        limit: 60,
      });
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
      set({ doc: { ...doc, blocks }, selected: index, message: `已插入 ${record.displayName}` });
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
    set({ doc: { ...doc, blocks: [...doc.blocks, block] }, selected: doc.blocks.length });
    void get().refresh();
  },

  select(index) {
    set({ selected: index });
  },

  setTitle(title) {
    set({ doc: { ...get().doc, title } });
  },

  updateSlot(index, path, value) {
    const doc = get().doc;
    const block = doc.blocks[index];
    if (!block || block.kind !== 'library') return;
    const matrix = patchSlot(block.matrix, path, value);
    const blocks = [...doc.blocks];
    blocks[index] = { ...block, matrix };
    set({ doc: { ...doc, blocks } });
    void get().refresh();
  },

  updateNative(index, patch) {
    const doc = get().doc;
    const block = doc.blocks[index];
    if (!block || block.kind !== 'native') return;
    const blocks = [...doc.blocks];
    blocks[index] = { ...block, node: { ...block.node, ...patch } };
    set({ doc: { ...doc, blocks } });
    void get().refresh();
  },

  addImageBlock(src) {
    const doc = get().doc;
    const block: api.NativeBlock = {
      kind: 'native',
      id: `blk-${Date.now().toString(36)}`,
      node: { kind: 'image', src },
    };
    set({ doc: { ...doc, blocks: [...doc.blocks, block] }, selected: doc.blocks.length });
    void get().refresh();
  },

  removeBlock(index) {
    const doc = get().doc;
    const blocks = doc.blocks.filter((_, position) => position !== index);
    set({ doc: { ...doc, blocks }, selected: null });
    void get().refresh();
  },

  moveBlock(from, to) {
    const doc = get().doc;
    if (from === to || from < 0 || to < 0 || from >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    const [moved] = blocks.splice(from, 1);
    if (!moved) return;
    blocks.splice(Math.min(to, blocks.length), 0, moved);
    set({ doc: { ...doc, blocks }, selected: to });
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

  newDoc() {
    set({ doc: emptyDoc(), selected: null, previews: {}, issues: [], message: '已新建' });
  },
}));
