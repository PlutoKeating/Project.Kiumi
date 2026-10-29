import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RoomInfo, TemplateIndexEntry, TemplateRecord } from '@kiumi/core';

export interface CatalogPaths {
  root: string;
  catalog: string;
  templates: string;
  assets: string;
  raw: string;
  uploads: string;
  index: string;
  rooms: string;
  pack: string;
  report: string;
  assetsManifest: string;
}

export function catalogPaths(dataDir: string): CatalogPaths {
  const root = path.resolve(dataDir);
  const catalog = path.join(root, 'catalog');
  return {
    root,
    catalog,
    templates: path.join(catalog, 'templates'),
    assets: path.join(root, 'assets'),
    raw: path.join(root, 'raw'),
    uploads: path.join(root, 'uploads'),
    index: path.join(catalog, 'index.json'),
    rooms: path.join(catalog, 'rooms.json'),
    pack: path.join(catalog, 'pack.json'),
    report: path.join(catalog, 'report.json'),
    assetsManifest: path.join(catalog, 'assets-manifest.json'),
  };
}

export async function ensureDirs(paths: CatalogPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.catalog, { recursive: true }),
    mkdir(paths.templates, { recursive: true }),
    mkdir(paths.assets, { recursive: true }),
    mkdir(paths.raw, { recursive: true }),
    mkdir(paths.uploads, { recursive: true }),
  ]);
}

/** `demo:header/t-a-01` -> `demo__header__t-a-01` */
export function slugOf(atomTplId: string): string {
  return atomTplId.replace(/[^a-zA-Z0-9._-]+/g, '__');
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeJson(
  file: string,
  value: unknown,
  pretty = true,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const body = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  await writeFile(tmp, `${body}\n`, 'utf8');
  await rename(tmp, file);
}

export async function writeTextAtomic(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, value, 'utf8');
  await rename(tmp, file);
}

export function fileExists(file: string): boolean {
  return existsSync(file);
}

export interface LoadedCatalog {
  paths: CatalogPaths;
  rooms: RoomInfo[];
  index: TemplateIndexEntry[];
  skeletons: Record<string, string>;
  assetsManifest: Record<string, string>;
}

/** Load the normalized catalog from disk. Throws when the crawl has not run. */
export async function loadCatalog(dataDir: string): Promise<LoadedCatalog> {
  const paths = catalogPaths(dataDir);
  const [rooms, index, skeletons, assetsManifest] = await Promise.all([
    readJson<RoomInfo[]>(paths.rooms),
    readJson<TemplateIndexEntry[]>(paths.index),
    readJson<Record<string, string>>(paths.pack),
    readJson<Record<string, string>>(paths.assetsManifest),
  ]);
  if (!index) {
    throw new Error(
      `catalog not found under ${paths.catalog}. Run "kiumi crawl all" first.`,
    );
  }
  return {
    paths,
    rooms: rooms ?? [],
    index,
    skeletons: skeletons ?? {},
    assetsManifest: assetsManifest ?? {},
  };
}

export async function loadRecord(
  paths: CatalogPaths,
  atomTplId: string,
): Promise<TemplateRecord | null> {
  return readJson<TemplateRecord>(path.join(paths.templates, `${slugOf(atomTplId)}.json`));
}
