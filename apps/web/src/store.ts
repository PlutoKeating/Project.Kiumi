import { prepareTemplate, transplantStyle } from './lib/template-style.ts';
import { patchRecordedHtml, sanitizeHtml, validateHtml, rewriteHtmlAssets, renderDocument as renderCore } from '@kiumi/core';
import { create } from 'zustand';
import * as api from './api.ts';
import { patchSlot } from './lib/slots.ts';
import { applyThemeColor, hasThemeColors } from './lib/theme.ts';

export interface RoomGroup {
  key: string;
  label: string;
  rooms: string[];
}

/** UI grouping over the upstream rooms, mirroring how editors organise tabs. */
export const ROOM_GROUPS: RoomGroup[] = [
  { key: 'header', label: '标题', rooms: ['demo:header'] },
  { key: 'card', label: '卡片', rooms: ['demo:card'] },
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
    rooms: ['demo:svg', 'paper-cp:sticker', 'paper-cp:element', 'paper-cp:separator-line'],
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
  themeColor: string;
  formatBrush: Record<string, unknown> | null;
  doc: api.Document;
  past: api.Document[];
  future: api.Document[];
  selected: number | null;
  selectedIds: string[];
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
  applyTheme: (color: string) => void;
  takeFormat: (index: number) => void;
  brushFormat: (index: number) => void;
  clearFormat: () => void;
  reloadTemplates: () => Promise<void>;
  insertTemplate: (atomTplId: string) => Promise<void>;
  applyTemplateStyle: (atomTplId: string) => Promise<void>;
  addNative: (kind: api.NativeNode['kind'], index?: number) => void;
  select: (index: number | null, additive?: boolean) => void;
  selectAll: () => void;
  batch: (action: 'copy'|'duplicate'|'delete') => void;
  moveInto: (from:number,to:number,path:number[]) => void;
  setTitle: (title: string) => void;
  setDigest: (digest: string) => void;
  updateSlot: (index: number, path: string, value: string, compIndex?: number) => void;
  updateNative: (index: number, patch: Partial<api.NativeNode>) => void;
  addImageBlock: (src: string) => void;
  removeBlock: (index: number) => void;
  moveBlock: (from: number, to: number) => void;
  refresh: () => Promise<void>;
  save: () => Promise<boolean>;
  newDoc: () => void;
  loadDoc: (doc: api.Document) => void;
  restoreScope: () => void;
  updateHtml: (index: number, html: string) => void;
  undo: () => void;
  redo: () => void;
  commit: (next: api.Document) => void;
  toggleFavorite: (atomTplId: string) => void;
  copyBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  insertClipboard: (clipIndex: number, at?: number) => void;
  clearClipboard: () => void;
}

const blockPreviewCache=new Map<string,{html:string;issues:api.Issue[]}>();
let saving: Promise<boolean> | null = null;

export const useStore = create<State>((set, get) => ({
  ready: false,
  rooms: [],
  templates: [],
  activeGroup: 'header',
  activeRoom: 'demo:header',
  query: '',
  loading: false,
  offset: 0,
  view: 'recommend',
  recent: [],
  zoom: 100,
  themeColor: '#3F6FE0',
  formatBrush: null,
  doc: emptyDoc(),
  past: [],
  future: [],
  selected: null,
  selectedIds: [],
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
      // Prefer the live tag corpus: it supersedes the archived rooms.
      const modernRooms = rooms.filter((room) => room.tag.startsWith('modern:') && room.count > 0);
      const modern = modernRooms.find((room) => room.name === '标题') ?? modernRooms[0];
      if (modern) {
        set({ rooms, ready: true, activeGroup: modern.tag, activeRoom: modern.tag });
      } else {
        set({ rooms, ready: true });
      }
      await get().reloadTemplates();
    } catch (error) {
      set({ message: `加载失败：${(error as Error).message}` });
    }
  },

  setGroup(key) {
    if (key === 'legacy') {
      const first = get().rooms.find((room) => !room.tag.startsWith('modern:'));
      if (first) set({ activeGroup: 'legacy', activeRoom: first.tag, offset: 0 });
      void get().reloadTemplates();
      return;
    }
    if (key.startsWith('modern:')) {
      set({ activeGroup: key, activeRoom: key, offset: 0 });
      void get().reloadTemplates();
      return;
    }
    const group = ROOM_GROUPS.find((item) => item.key === key);
    const first = group?.rooms.find((room) => get().rooms.some((entry) => entry.tag === room));
    set({ activeGroup: key, activeRoom: first ?? null, offset: 0 });
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

  takeFormat(index) {
    const block=get().doc.blocks[index];if(!block)return;
    if(block.kind==='native'){set({formatBrush:{...block.node.style},message:'已取格式'});return;}
    if(block.html){const template=document.createElement('template');template.innerHTML=block.html;const node=template.content.querySelector<HTMLElement>('p,span,h1,h2,h3')??template.content.firstElementChild as HTMLElement|null;
      if(node){const style:Record<string,string>={};for(const name of ['font-size','font-family','font-weight','font-style','color','text-align','line-height','letter-spacing','text-decoration']){const value=node.style.getPropertyValue(name);if(value)style[name]=value;}set({formatBrush:style,message:'已取格式'});return;}}
    const first=Array.isArray(block.matrix)?block.matrix[0]:block.matrix;
    set({formatBrush:structuredClone((first as any)?._comp?.style??{}),message:'已取格式'});
  },
  brushFormat(index) {
    const brush=get().formatBrush,doc=get().doc,block=doc.blocks[index];
    if(!brush||!block)return;
    const blocks=[...doc.blocks];
    if(block.kind==='native')blocks[index]={...block,node:{...block.node,style:{...block.node.style,...brush} as Record<string,string>}};
    else if(block.html){const template=document.createElement('template');template.innerHTML=block.html;
      const nodes=[...template.content.querySelectorAll<HTMLElement>('p,span,h1,h2,h3,li,td')];
      if(!nodes.length&&template.content.firstElementChild)nodes.push(template.content.firstElementChild as HTMLElement);
      for(const node of nodes)for(const [name,value] of Object.entries(brush))node.style.setProperty(name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),String(value));
      blocks[index]={...block,html:template.innerHTML};
    } else {const matrix=structuredClone(block.matrix) as any;const first=Array.isArray(matrix)?matrix[0]:matrix;if(first?._comp)first._comp.style={...first._comp.style,...brush};blocks[index]={...block,matrix};}
    get().commit({...doc,blocks});set({message:'已刷格式'});void get().refresh();
  },

  clearFormat() {
    set({ formatBrush: null, message: '格式刷已清除' });
  },

  applyTheme(color) {
    const doc = get().doc;
    let touched = 0;
    const blocks = doc.blocks.map((block) => {
      if (block.kind !== 'library' || !hasThemeColors(block.matrix)) return block;
      touched++;
      const matrix=applyThemeColor(block.matrix,color);
      return { ...block, matrix, html:block.html?patchRecordedHtml(block.html,block.matrix,matrix):undefined };
    });
    if (!touched) {
      set({ themeColor: color, message: '当前文档没有可换色的模板' });
      return;
    }
    get().commit({ ...doc, blocks });
    set({ themeColor: color, message: `已对 ${touched} 个模板块换色` });
    void get().refresh();
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
      if (get().activeRoom !== activeRoom || get().query !== query || get().offset !== offset || get().view !== view) return;
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
        html: prepareTemplate(record.html),
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

  async applyTemplateStyle(atomTplId) {
    const {doc,selected} = get();
    if (selected === null) { set({message:'请先选中需要换样式的内容块'}); return; }
    const source = doc.blocks[selected];
    try {
      const record = await api.fetchTemplate(atomTplId);
      if (get().doc !== doc) throw new Error('文稿已发生变化，请重新选择后应用样式');
      const sourceHtml = source.kind === 'library' && source.html ? source.html : renderCore({...doc,blocks:[source]}).html;
      const html = transplantStyle(sourceHtml,record.html);
      const blocks = [...doc.blocks];
      blocks[selected] = {kind:'library',id:source.id,tplId:record.atomTplId,matrix:[],html};
      get().commit({...doc,blocks});
      set({message:'已应用模板样式，内容保留，可撤销'});
      void get().refresh();
    } catch (error) { set({message:`应用样式失败：${(error as Error).message}`}); }
  },

  addNative(kind, index) {
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
    const blocks = [...doc.blocks];
    const at = index === undefined ? blocks.length : index;
    blocks.splice(at, 0, block);
    get().commit({ ...doc, blocks });
    set({ selected: at });
    void get().refresh();
  },

  select(index, additive=false) {
    if(index===null){set({selected:null,selectedIds:[]});return;}
    const block=get().doc.blocks[index];if(!block)return;
    const ids=additive ? (get().selectedIds.includes(block.id)?get().selectedIds.filter(id=>id!==block.id):[...get().selectedIds,block.id]) : [block.id];
    set({ selected:index,selectedIds:ids });
  },
  selectAll() {set({selectedIds:get().doc.blocks.map(b=>b.id),selected:get().doc.blocks.length?0:null});},
  batch(action) {
    const {doc,selectedIds,selected}=get();const ids=selectedIds.length?selectedIds:selected===null?[]:[doc.blocks[selected]!.id];
    if(action==='copy'){const clipboard=doc.blocks.filter(b=>ids.includes(b.id)).map(b=>structuredClone(b));writeLocal(CLIPBOARD_KEY,clipboard);set({clipboard,message:`已复制 ${clipboard.length} 块`});return;}
    const blocks=action==='delete'?doc.blocks.filter(b=>!ids.includes(b.id)):doc.blocks.flatMap(b=>ids.includes(b.id)?[b,{...structuredClone(b),id:crypto.randomUUID()}]:[b]);
    get().commit({...doc,blocks});set({selected:null,selectedIds:[]});void get().refresh();
  },
  moveInto(from,to,path) {
    const doc=get().doc,source=doc.blocks[from],target=doc.blocks[to];
    if(!source||!target||from===to||target.kind!=='library'||!target.html)return;
    const root=document.createElement('template');root.innerHTML=sanitizeHtml(target.html);
    let node:Node=root.content;
    for(const part of path){const child=node.childNodes[part];if(!child)return;node=child;}
    if(!(node instanceof HTMLElement)||!['DIV','SECTION','TD','LI','BLOCKQUOTE'].includes(node.tagName))return;
    const html=source.kind==='library'&&source.html?source.html:renderCore({...doc,blocks:[source]}).html;
    node.insertAdjacentHTML('beforeend',sanitizeHtml(html));
    const blocks=doc.blocks.map((b,i)=>i===to?{...target,html:root.innerHTML}:b).filter((_,i)=>i!==from);
    get().commit({...doc,blocks});set({selected:from<to?to-1:to,selectedIds:[]});void get().refresh();
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
    blocks[index] = { ...block, matrix, html: block.html ? patchRecordedHtml(block.html, block.matrix, matrix) : undefined };
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
    if(get().selectedIds.length>1 && get().selectedIds.includes(get().doc.blocks[index]?.id??'')){get().batch('delete');return;}
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
    if (JSON.stringify(next.blocks) === JSON.stringify(doc.blocks) && next.title === doc.title && JSON.stringify(next.meta) === JSON.stringify(doc.meta)) return;
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
        const key=JSON.stringify(block);
        let result=blockPreviewCache.get(key);
        if(!result){
          const rendered = renderCore({...doc,blocks:[block]});
          // Internal URLs are valid in the authenticated editor. Export validation stays strict.
          const validationHtml = rewriteHtmlAssets(rendered.html, raw => /^\/(?:uploads|assets)\//.test(raw) ? new URL(raw, location.origin).href : raw);
          result = {...rendered, issues: validateHtml(validationHtml)};
          if(blockPreviewCache.size>200)blockPreviewCache.clear();
          blockPreviewCache.set(key,result);
        }
        previews[block.id] = result.html;
        issues.push(...result.issues.map((issue) => ({ ...issue, selector: block.id })));
      } catch (error) {
        previews[block.id] = `<p style="color:#c33">渲染失败：${(error as Error).message}</p>`;
      }
    }
    if (token === previewToken) set({ previews, issues });
  },

  async save() {
    if (saving) {await saving;return get().save();}
    const doc = structuredClone(get().doc), scope = api.workspaceKey();
    if (!api.teamId()) { set({message:'已保存在本机；登录并选择团队后可保存到云端'}); return false; }
    saving = (async () => {
      try {
        const saved = doc.id.startsWith('local-')
          ? await api.createDocument(doc.title, doc.blocks, doc.meta)
          : await api.saveDocument(doc);
        if (scope === api.workspaceKey() && get().doc.id === doc.id) {
          set({doc:{...get().doc,id:saved.id,meta:{...get().doc.meta,createdAt:saved.meta.createdAt}},message:'已保存到团队'});
        }
        return true;
      } catch (error) { if(scope === api.workspaceKey()) set({message:`保存失败：${(error as Error).message}`}); return false; }
      finally { saving = null; }
    })();
    return saving;
  },

  loadDoc(doc) {
    set({doc,selected:null,selectedIds:[],past:[],future:[],previews:{},message:'已打开文稿'});
    void get().refresh();
  },
  restoreScope() {
    get().loadDoc(readLocal<api.Document>(api.workspaceKey(), emptyDoc()));
  },
  updateHtml(index, html) {
    const doc=get().doc, block=doc.blocks[index];
    if(!block) return;
    html=block.kind === 'library' && !block.tplId.startsWith('imported:') ? prepareTemplate(html) : sanitizeHtml(html);
    const blocks=[...doc.blocks];
    blocks[index]=block.kind==='library' ? {...block,html} : {...block,node:{...block.node,html}};
    get().commit({...doc,blocks}); void get().refresh();
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
      selectedIds: [],
      previews: {},
      issues: [],
      message: '已新建',
    });
  },
}));

useStore.subscribe((state, previous) => {
  if (state.doc !== previous.doc) writeLocal(api.workspaceKey(), state.doc);
});
