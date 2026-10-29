import { readCatalogIndex } from './lib/catalog-index.ts';
import { cachedCatalog } from './lib/catalog-cache.ts';
export interface Room {
  tag: string;
  name: string;
  order: number;
  house: string;
  floor: string;
  count: number;
}

export interface TemplateIndexEntry {
  atomTplId: string;
  displayName: string;
  room: string;
  accessibility: string;
  hasSvg: boolean;
  hasAnimation: boolean;
  byteSize: number;
  updatedAt?: string;
}

export interface TemplateRecord extends TemplateIndexEntry {
  matrix: unknown;
  html: string;
  tplIds: string[];
  assetUrls: string[];
}

export interface NativeNode {
  kind: 'text' | 'heading' | 'image' | 'divider' | 'spacer' | 'group' | 'quote';
  html?: string;
  text?: string;
  src?: string;
  level?: 1 | 2 | 3;
  align?: 'left' | 'center' | 'right';
  width?: string;
  height?: number;
  direction?: 'vertical' | 'horizontal';
  children?: NativeNode[];
  style?: Record<string, string>;
}

export interface LibraryBlock {
  kind: 'library';
  id: string;
  tplId: string;
  matrix: unknown;
  html?: string;
}

export interface NativeBlock {
  kind: 'native';
  id: string;
  node: NativeNode;
}

export type Block = LibraryBlock | NativeBlock;

export interface Document {
  version: 1;
  id: string;
  title: string;
  blocks: Block[];
  meta: { createdAt: string; updatedAt: string; author?: string; digest?: string; cover?: string; tags?: string[] };
}

export interface Issue {
  rule: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  selector?: string;
}

export interface RenderResponse {
  html: string;
  bytes: number;
  warnings: unknown[];
  issues: Issue[];
}

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

let activeTeam = '';
let activeUser = 'guest';
export const workspaceKey = () => `kiumi.draft.${activeUser}.${activeTeam || 'local'}`;
export const teamId = () => activeTeam;
export function setWorkspace(user: string, team: string) { activeUser=user; activeTeam=team; }
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(activeTeam ? { 'x-team-id': activeTeam } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => {
    throw new ApiError(`服务响应异常 (${response.status})`, response.status);
  }) as Envelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new ApiError((typeof payload.error === 'string' ? payload.error : payload.error?.message) ?? `request failed: ${response.status}`, response.status);
  }
  return payload.data;
}

export interface SessionUser {
  sub: string;
  name?: string;
  email?: string;
}

export interface SessionState {
  user: SessionUser | null;
  loginEnabled: boolean;
  /** Static builds talk to the local server directly, so there may be no session endpoint. */
  unavailable?: boolean;
}

export async function fetchSession(): Promise<SessionState> {
  try {
    return await request<SessionState>('/api/me');
  } catch {
    return { user: null, loginEnabled: false, unavailable: true };
  }
}

/** Full page navigation keeps the HttpOnly session cookie in the Worker. */
export function loginUrl(next = '/'): string {
  return `/auth/login?next=${encodeURIComponent(next)}`;
}

export function logoutUrl(): string {
  return '/auth/logout';
}

export function fetchRooms(): Promise<Room[]> {
  return cachedCatalog<Room[]>('/api/rooms');
}

export interface TemplateQuery {
  room?: string;
  q?: string;
  limit?: number;
  offset?: number;
  hasSvg?: boolean;
}
export async function fetchTemplates(params: TemplateQuery): Promise<TemplateIndexEntry[]> {
  const index = await readCatalogIndex();
  if (!index) return fetchTemplatePage(params);
  const q = (params.q || '').toLowerCase();
  const seen = new Set<string>();
  const filtered = index.filter(item => {
    if ((params.room && item.room !== params.room) || (params.hasSvg && !item.hasSvg) || (q && !`${item.displayName} ${item.atomTplId}`.toLowerCase().includes(q)) || seen.has(item.atomTplId)) return false;
    seen.add(item.atomTplId); return true;
  });
  const offset = params.offset || 0;
  return filtered.slice(offset, offset + (params.limit || 50));
}
export function fetchTemplatePage(params: TemplateQuery, revalidate = false): Promise<TemplateIndexEntry[]> {
  const search = new URLSearchParams();
  if (params.room) search.set('room', params.room);
  if (params.q) search.set('q', params.q);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));
  if (params.hasSvg) search.set('hasSvg', 'true');
  return cachedCatalog<TemplateIndexEntry[]>(`/api/templates?${search.toString()}`, revalidate);
}

export function fetchTemplate(id: string): Promise<TemplateRecord> {
  return cachedCatalog<TemplateRecord>(`/api/template?id=${encodeURIComponent(id)}&localAssets=true`);
}

export function previewUrl(id: string): string {
  return `/api/template/preview?id=${encodeURIComponent(id)}`;
}

export function renderDocument(doc: Document): Promise<RenderResponse> {
  return request<RenderResponse>('/api/render', {
    method: 'POST',
    body: JSON.stringify({ document: doc }),
  });
}

/** Canvas previews use local mirrored assets so they survive CDN hotlink rules. */
export function renderBlock(block: Block, doc: Document): Promise<RenderResponse> {
  return request<RenderResponse>('/api/render', {
    method: 'POST',
    body: JSON.stringify({
      document: { ...doc, blocks: [block] },
      localAssets: true,
    }),
  });
}

export function createDocument(title: string, blocks: Block[] = [], meta?: Document['meta']): Promise<Document> {
  return request<Document>('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title, blocks, meta }),
  });
}

export function saveDocument(doc: Document): Promise<Document> {
  return request<Document>(`/api/documents/${doc.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: doc.title, blocks: doc.blocks, meta: doc.meta }),
  });
}

export function listDocuments(): Promise<{ id: string; title: string; blocks: number; updatedAt: string }[]> {
  return request('/api/documents');
}

export function openDocument(id: string): Promise<Document> {
  return request<Document>(`/api/documents/${id}`);
}

export function uploadImage(file: File, signal?: AbortSignal): Promise<{ sha256: string; bytes: number; url: string }> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/assets/upload', { method: 'POST', body: form, signal });
}

export async function copyRichHtml(html: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(html);
}

export interface Team { id: string; name: string; role: 'owner' | 'member' }
export const listTeams = () => request<Team[]>('/api/teams');
export const createTeam = (name:string) => request<Team>('/api/teams',{method:'POST',body:JSON.stringify({name})});
export const joinTeam = (code:string) => request<{id:string}>('/api/teams/join',{method:'POST',body:JSON.stringify({code})});
export const deleteDocument = (id:string) => request(`/api/documents/${id}`,{method:'DELETE'});
export const listUploads = () => request<{id:string;name:string;bytes:number;mtime:number;url:string}[]>('/api/uploads');
