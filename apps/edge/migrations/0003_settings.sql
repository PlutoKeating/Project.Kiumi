-- Site-wide settings edited from the admin panel (model providers, keys, purposes).
-- One JSON document per key; `version` is the optimistic lock the panel saves against.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT
);
