#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateHtml } from '@kiumi/core';
import { DocumentBuilder, FileDocumentStore, KiumiClient, fillMatrix } from '@kiumi/sdk';

const dataDir = process.env.KIUMI_DATA_DIR ?? './data';
const kiumi = new KiumiClient({ dataDir });
const documents = new FileDocumentStore(dataDir);

const server = new McpServer({ name: 'kiumi', version: '0.1.0' });

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(code: string, message: string, details?: unknown): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: false, error: { code, message, details } }, null, 2),
      },
    ],
  };
}

async function loadDoc(id: string) {
  const doc = await documents.get(id);
  if (!doc) return null;
  return doc;
}

// ---------------------------------------------------------------------------
// Catalog (read-only)
// ---------------------------------------------------------------------------

server.registerTool(
  'kiumi_list_rooms',
  {
    title: 'List template rooms',
    description: 'List template categories (rooms) available in the local catalog.',
    inputSchema: {
      house: z.string().optional().describe('paper | booklet'),
      floor: z.string().optional().describe('comp | page'),
    },
  },
  async ({ house, floor }) => ok(await kiumi.rooms({ house, floor })),
);

server.registerTool(
  'kiumi_list_templates',
  {
    title: 'List templates',
    description: 'List catalog templates filtered by room, name/id substring or SVG presence.',
    inputSchema: {
      room: z.string().optional().describe('room tag, e.g. demo:header'),
      q: z.string().optional().describe('substring of name or atom_tpl_id'),
      hasSvg: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
  },
  async (args) => ok(await kiumi.list(args)),
);

server.registerTool(
  'kiumi_get_template',
  {
    title: 'Get template',
    description: 'Fetch one template record including its structured matrix and rendered HTML.',
    inputSchema: {
      atomTplId: z.string().min(1),
      includeHtml: z.boolean().optional().describe('include the rendered HTML (large)'),
    },
  },
  async ({ atomTplId, includeHtml }) => {
    const record = await kiumi.get(atomTplId);
    if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${atomTplId}`);
    const { html, ...rest } = record;
    return ok(includeHtml ? record : { ...rest, htmlBytes: Buffer.byteLength(html, 'utf8') });
  },
);

server.registerTool(
  'kiumi_search_templates',
  {
    title: 'Search templates',
    description: 'Full-text search over template names and rendered content.',
    inputSchema: {
      q: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ q, limit }) => ok(await kiumi.search(q, limit ?? 20)),
);

// ---------------------------------------------------------------------------
// Documents (write)
// ---------------------------------------------------------------------------

server.registerTool(
  'kiumi_create_document',
  {
    title: 'Create document',
    description: 'Create an empty document and return its id.',
    inputSchema: { title: z.string().min(1) },
  },
  async ({ title }) => ok(await documents.create(title)),
);

server.registerTool(
  'kiumi_list_documents',
  {
    title: 'List documents',
    description: 'List stored documents.',
    inputSchema: {},
  },
  async () => ok(await documents.list()),
);

server.registerTool(
  'kiumi_get_document',
  {
    title: 'Get document',
    description: 'Read a document by id.',
    inputSchema: { documentId: z.string().min(1) },
  },
  async ({ documentId }) => {
    const doc = await loadDoc(documentId);
    return doc ? ok(doc) : fail('DOCUMENT_NOT_FOUND', `no document ${documentId}`);
  },
);

server.registerTool(
  'kiumi_insert_template',
  {
    title: 'Insert template block',
    description: 'Insert a library template into a document, optionally filling slots.',
    inputSchema: {
      documentId: z.string().min(1),
      atomTplId: z.string().min(1),
      index: z.number().int().min(0).optional(),
      fill: z.record(z.string(), z.string()).optional().describe('slot -> value, e.g. {"txt1":"<p>hi</p>"}'),
    },
  },
  async ({ documentId, atomTplId, index, fill }) => {
    const doc = await loadDoc(documentId);
    if (!doc) return fail('DOCUMENT_NOT_FOUND', `no document ${documentId}`);
    const record = await kiumi.get(atomTplId);
    if (!record) return fail('TEMPLATE_NOT_FOUND', `no template ${atomTplId}`);

    const builder = DocumentBuilder.fromJSON(doc);
    builder.addLibraryBlock(
      { atomTplId: record.atomTplId, matrix: fill ? fillMatrix(record.matrix, fill) : record.matrix },
      index,
    );
    await documents.put(builder.toJSON());
    return ok({ documentId, blocks: builder.doc.blocks.length });
  },
);

server.registerTool(
  'kiumi_fill_block',
  {
    title: 'Fill block slots',
    description: 'Patch slot values on a library block (text, image src, styles).',
    inputSchema: {
      documentId: z.string().min(1),
      blockIndex: z.number().int().min(0),
      set: z.record(z.string(), z.string()),
    },
  },
  async ({ documentId, blockIndex, set }) => {
    const doc = await loadDoc(documentId);
    if (!doc) return fail('DOCUMENT_NOT_FOUND', `no document ${documentId}`);
    const block = doc.blocks[blockIndex];
    if (!block) return fail('INVALID_DOCUMENT', `no block at index ${blockIndex}`);
    if (block.kind !== 'library') return fail('INVALID_DOCUMENT', 'block is not a library block');

    const builder = DocumentBuilder.fromJSON(doc).fillBlock(blockIndex, set);
    await documents.put(builder.toJSON());
    return ok({ documentId, blockIndex, applied: Object.keys(set) });
  },
);

server.registerTool(
  'kiumi_update_text',
  {
    title: 'Update block text',
    description: 'Replace the text slot of a library block. Plain text is wrapped in <p>.',
    inputSchema: {
      documentId: z.string().min(1),
      blockIndex: z.number().int().min(0),
      slot: z.string().default('txt1'),
      text: z.string(),
    },
  },
  async ({ documentId, blockIndex, slot, text }) => {
    const doc = await loadDoc(documentId);
    if (!doc) return fail('DOCUMENT_NOT_FOUND', `no document ${documentId}`);
    const value = text.includes('<') ? text : `<p>${text}</p>`;
    const builder = DocumentBuilder.fromJSON(doc).fillBlock(blockIndex, { [slot]: value });
    await documents.put(builder.toJSON());
    return ok({ documentId, blockIndex, slot });
  },
);

// ---------------------------------------------------------------------------
// Render and validate
// ---------------------------------------------------------------------------

server.registerTool(
  'kiumi_render_document',
  {
    title: 'Render document',
    description: 'Render a stored document (or an inline document) into WeChat-ready HTML.',
    inputSchema: {
      documentId: z.string().optional(),
      document: z.record(z.string(), z.unknown()).optional().describe('inline document JSON'),
      includeHtml: z.boolean().optional(),
    },
  },
  async ({ documentId, document, includeHtml }) => {
    const doc = documentId ? await loadDoc(documentId) : (document as never);
    if (!doc) return fail('DOCUMENT_NOT_FOUND', `no document ${documentId ?? '<inline>'}`);
    const result = await kiumi.renderDocument(doc);
    const issues = validateHtml(result.html);
    const payload = {
      bytes: result.bytes,
      warnings: result.warnings,
      issues,
      html: includeHtml === false ? undefined : result.html,
    };
    return ok(payload);
  },
);

server.registerTool(
  'kiumi_validate_html',
  {
    title: 'Validate HTML',
    description: 'Check rendered HTML against WeChat compatibility rules.',
    inputSchema: {
      html: z.string().min(1),
      maxBytes: z.number().int().min(1000).optional(),
    },
  },
  async ({ html, maxBytes }) => ok({ bytes: Buffer.byteLength(html, 'utf8'), issues: validateHtml(html, { maxBytes }) }),
);

server.registerTool(
  'kiumi_export_wechat_draft',
  {
    title: 'Export to WeChat draft',
    description: 'Push a document to the WeChat official-account draft box. Requires server-side credentials.',
    inputSchema: { documentId: z.string().min(1) },
  },
  async () =>
    fail(
      'WECHAT_NOT_CONFIGURED',
      'WeChat credentials are not configured for the MCP process; run the HTTP service with WECHAT_APP_ID / WECHAT_APP_SECRET instead.',
    ),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`kiumi mcp ready (data dir: ${dataDir})`);
}

main().catch((error: unknown) => {
  console.error(`kiumi mcp failed: ${(error as Error).message}`);
  process.exit(1);
});
