-- D1 schema for documents. Apply with:
--   npx wrangler d1 execute kiumi --file=apps/edge/schema.sql --remote
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  blocks TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_updated_at ON documents (updated_at DESC);
