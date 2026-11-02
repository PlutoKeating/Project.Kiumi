-- Document revisions (optimistic concurrency + live updates), team typesetting rules,
-- and the recognized manuscript kept beside a document so Agents can re-style it.
ALTER TABLE documents ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
ALTER TABLE teams ADD COLUMN typeset_rules TEXT;
CREATE TABLE IF NOT EXISTS manuscripts (
  doc_id TEXT PRIMARY KEY, team_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL
);
