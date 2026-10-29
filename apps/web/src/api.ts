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
  meta: { createdAt: string; updatedAt: string; author?: string; digest?: string };
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `request failed: ${response.status}`);
  }
  return payload.data;
}

export function fetchRooms(): Promise<Room[]> {
  return request<Room[]>('/api/rooms');
}

export function fetchTemplates(params: {
  room?: string;
  q?: string;
  limit?: number;
  offset?: number;
  hasSvg?: boolean;
}): Promise<TemplateIndexEntry[]> {
  const search = new URLSearchParams();
  if (params.room) search.set('room', params.room);
  if (params.q) search.set('q', params.q);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));
  if (params.hasSvg) search.set('hasSvg', 'true');
  return request<TemplateIndexEntry[]>(`/api/templates?${search.toString()}`);
}

export function fetchTemplate(id: string): Promise<TemplateRecord> {
  return request<TemplateRecord>(`/api/template?id=${encodeURIComponent(id)}`);
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

export function createDocument(title: string): Promise<Document> {
  return request<Document>('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function saveDocument(doc: Document): Promise<Document> {
  return request<Document>(`/api/documents/${doc.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: doc.title, blocks: doc.blocks }),
  });
}

export function listDocuments(): Promise<{ id: string; title: string; blocks: number; updatedAt: string }[]> {
  return request('/api/documents');
}

export function openDocument(id: string): Promise<Document> {
  return request<Document>(`/api/documents/${id}`);
}

export function uploadImage(file: File): Promise<{ sha256: string; bytes: number; url: string }> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/assets/upload', { method: 'POST', body: form });
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
