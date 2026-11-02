import { applyOps, type DocOp, type KiumiDocument } from '@kiumi/core';
import type { Env } from './index.js';
import type { ChangeNotice } from './hub.js';
import { ApiError } from './workspace.js';

export function documentFrom(row: any): KiumiDocument {
  return {
    version: 1, id: row.id, title: row.title, blocks: JSON.parse(row.blocks),
    meta: { createdAt: row.updated_at, ...JSON.parse(row.meta || '{}'), updatedAt: row.updated_at, rev: row.rev ?? 1 },
  };
}

/** Tell every open editor of this document that it changed. Best effort. */
export async function notify(env: Env, documentId: string, notice: ChangeNotice): Promise<void> {
  if (!env.DOC_HUB) return;
  try {
    const body = JSON.stringify(notice);
    // Large payloads are replaced by a bare notice; clients then refetch.
    const slim = body.length > 100_000 ? JSON.stringify({ ...notice, ops: undefined }) : body;
    await env.DOC_HUB.get(env.DOC_HUB.idFromName(documentId)).fetch('https://hub/publish', { method: 'POST', body: slim });
  } catch (error) { console.error('notify failed', (error as Error).message); }
}

export async function loadDocument(env: Env, teamId: string, documentId: string): Promise<KiumiDocument> {
  const row = await env.DB.prepare('SELECT * FROM documents WHERE id=? AND team_id=?').bind(documentId, teamId).first<any>();
  if (!row) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', '文稿不存在');
  return documentFrom(row);
}

/**
 * Apply ops atomically against the current revision (retrying on a concurrent write),
 * then announce the result. All Agent edits go through here.
 */
export async function commitOps(env: Env, teamId: string, documentId: string, ops: DocOp[], by: 'user' | 'agent' = 'agent', from?: string): Promise<{ doc: KiumiDocument; errors: string[] }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await env.DB.prepare('SELECT * FROM documents WHERE id=? AND team_id=?').bind(documentId, teamId).first<any>();
    if (!row) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', '文稿不存在');
    const current = documentFrom(row);
    const { doc, errors } = applyOps(current, ops);
    if (errors.length) throw new ApiError(422, 'OPS_FAILED', errors.join('；'));
    if (JSON.stringify(doc.blocks).length > 3_500_000) throw new ApiError(413, 'TOO_LARGE', '文稿过大');
    const stamp = new Date().toISOString();
    const { createdAt: _c, updatedAt: _u, rev: _r, ...meta } = doc.meta;
    const result = await env.DB.prepare('UPDATE documents SET title=?,blocks=?,meta=?,updated_at=?,rev=rev+1 WHERE id=? AND team_id=? AND rev=?')
      .bind(doc.title, JSON.stringify(doc.blocks), JSON.stringify(meta), stamp, documentId, teamId, row.rev ?? 1).run();
    if (!result.meta.changes) continue;
    const rev = (row.rev ?? 1) + 1;
    const committed = { ...doc, meta: { ...doc.meta, updatedAt: stamp, rev } };
    await notify(env, documentId, { type: 'changed', rev, by, from, ops, title: doc.title });
    return { doc: committed, errors };
  }
  throw new ApiError(409, 'REV_CONFLICT', '文稿正被同时修改，请重试');
}
