-- D1 schema for documents. Apply with:
--   npx wrangler d1 execute kiumi --file=apps/edge/schema.sql --remote
-- Existing databases created before sign-in added owner_sub need:
--   ALTER TABLE documents ADD COLUMN owner_sub TEXT;
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  blocks TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  owner_sub TEXT
);
CREATE INDEX IF NOT EXISTS documents_updated_at ON documents (updated_at DESC);
CREATE INDEX IF NOT EXISTS documents_owner ON documents (owner_sub, updated_at DESC);
