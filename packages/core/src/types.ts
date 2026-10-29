/**
 * Core data types.
 *
 * The shape mirrors the upstream template payload found by reverse engineering
 * (`matrix` + `renderer_accelerate`), but normalizes it so that every node has an
 * explicit `meta` / `slots` split instead of a `_comp` key mixed with slot keys.
 */

export type CellType =
  | 'text'
  | 'group'
  | 'image'
  | 'video'
  | 'shape'
  | 'table'
  | 'container'
  | 'unknown';

export type StyleValue = string | number | null | undefined;
export type StyleMap = Record<string, StyleValue>;

export interface CompPose {
  width?: string | null;
  height?: string | null;
  position?: string | null;
}

export interface CompConstraint {
  pose?: { resize?: string };
  opMenu?: Record<string, boolean>;
  childLayout?: string;
  [key: string]: unknown;
}

export interface CompAuxEntry {
  type?: string;
  value?: unknown;
}

export type CompAux = Record<string, CompAuxEntry>;

export interface CompMeta {
  tplId: string;
  constraint?: CompConstraint;
  pose?: CompPose;
  style?: StyleMap;
  aux?: CompAux;
  link?: string | null;
  linkFrame?: boolean | null;
  anim?: unknown;
  [key: string]: unknown;
}

export interface Cell {
  type: CellType;
  style?: StyleMap;
  items?: Comp[];
  text?: string;
  src?: string;
  link?: string | null;
  linkFrame?: boolean | null;
  constraint?: Record<string, unknown>;
  anim?: unknown;
  [key: string]: unknown;
}

export interface Comp {
  meta: CompMeta;
  slots: Record<string, Cell>;
}

/** One catalog record, as stored on disk and served by the API. */
export interface TemplateRecord {
  atomTplId: string;
  templateId?: number;
  displayName: string;
  room: string;
  category?: string;
  accessibility: 'Public' | 'Obsolete' | string;
  visibility?: string;
  creatorId?: number;
  version?: number;
  level?: string;
  featureRequires?: string[];
  orderNum?: number;
  createdAt?: string;
  updatedAt?: string;
  /** true when the rendered HTML embeds an <svg> element. */
  hasSvg: boolean;
  /** true when the rendered HTML contains any SVG animation primitive. */
  hasAnimation: boolean;
  /** UTF-8 byte length of `html`, used to reason about WeChat body limits. */
  byteSize: number;
  html: string;
  matrix: unknown;
  /** Every component skeleton this record depends on. */
  tplIds: string[];
  /** Every remote asset referenced by this record. */
  assetUrls: string[];
  source: string;
  fetchedAt: string;
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

export interface RoomInfo {
  tag: string;
  name: string;
  order: number;
  house: string;
  floor: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface NativeNode {
  kind:
    | 'text'
    | 'heading'
    | 'image'
    | 'divider'
    | 'spacer'
    | 'group'
    | 'quote';
  html?: string;
  text?: string;
  src?: string;
  level?: 1 | 2 | 3;
  align?: 'left' | 'center' | 'right';
  width?: string;
  height?: number;
  direction?: 'vertical' | 'horizontal';
  children?: NativeNode[];
  style?: StyleMap;
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

export interface KiumiDocument {
  version: 1;
  id: string;
  title: string;
  blocks: Block[];
  meta: {
    createdAt: string;
    updatedAt: string;
    author?: string;
  };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
  rule: string;
  level: IssueLevel;
  message: string;
  selector?: string;
  detail?: unknown;
}

export interface Warning {
  code: string;
  message: string;
  tplId?: string;
  slot?: string;
}

export interface RenderResult {
  html: string;
  bytes: number;
  warnings: Warning[];
}
