CREATE TABLE writing_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lease TEXT,
  lease_until INTEGER,
  response TEXT
);
--> statement-breakpoint
CREATE INDEX writing_jobs_pending ON writing_jobs(status, created_at);
--> statement-breakpoint
CREATE TABLE writing_bridge (id INTEGER PRIMARY KEY, last_seen INTEGER NOT NULL);
