-- D1 initial schema for Blog Automation System
-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'google',
  provider_user_id TEXT,
  email TEXT UNIQUE,
  name TEXT,
  picture TEXT,
  role TEXT NOT NULL DEFAULT 'VIEWER',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_users_provider_user ON users(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Sessions (optional if using JWT)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Sheet Sources
CREATE TABLE IF NOT EXISTS sheet_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  spreadsheet_id TEXT NOT NULL,
  sheet_name TEXT,
  range TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Articles
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id TEXT, -- external key (e.g., sheet row id)
  title TEXT NOT NULL,
  topic TEXT,
  keywords TEXT, -- comma separated for simplicity
  target_length INTEGER,
  tone TEXT,
  audience TEXT,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|error
  word_count INTEGER,
  generated_at DATETIME,
  drive_file_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_ext_id ON articles(ext_id);

-- Generation Jobs
CREATE TABLE IF NOT EXISTS generation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  source_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|running|succeeded|failed
  attempt INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  payload TEXT, -- JSON
  logs TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE SET NULL,
  FOREIGN KEY(source_id) REFERENCES sheet_sources(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_article ON generation_jobs(article_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON generation_jobs(idempotency_key);

-- Files (Drive links)
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  drive_file_id TEXT,
  mime_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- API Tokens (e.g., Google OAuth tokens)
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  provider TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  scope TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tokens_user_provider ON api_tokens(user_id, provider);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
