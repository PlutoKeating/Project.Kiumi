-- Reference schema. Deploy with pnpm d1:schema (versioned migrations).
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, blocks TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL, owner_sub TEXT, team_id TEXT, meta TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_sub TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE members (
  team_id TEXT NOT NULL REFERENCES teams(id), user_sub TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')),
  PRIMARY KEY(team_id,user_sub)
);
CREATE INDEX members_user ON members(user_sub);
CREATE INDEX documents_team ON documents(team_id, updated_at DESC);
CREATE TABLE invites (
  code TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), expires_at TEXT NOT NULL
);
CREATE TABLE uploads (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX uploads_team ON uploads(team_id,created_at DESC);
CREATE TABLE wechat_accounts (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), name TEXT NOT NULL,
  app_id TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(team_id,app_id)
);
CREATE TABLE draft_jobs (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, account_id TEXT NOT NULL,
  document_id TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL
);
