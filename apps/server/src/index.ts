#!/usr/bin/env node
import path from 'node:path';
import { buildApp } from './app.ts';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

// Resolve relative data dirs against the repository root so `pnpm dev`
// (which runs the server with cwd=apps/server) still finds ./data.
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const configured = process.env.KIUMI_DATA_DIR ?? 'data';
const dataDir = path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);

const app = await buildApp({ dataDir, logger: process.env.KIUMI_LOG === '1' });

try {
  await app.listen({ port, host });
  console.log(`kiumi server listening on http://${host}:${port} (data: ${dataDir})`);
} catch (error) {
  console.error(`failed to start: ${(error as Error).message}`);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}
