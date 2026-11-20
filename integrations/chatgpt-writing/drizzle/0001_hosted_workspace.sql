CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE workspace_articles (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
 data_json TEXT NOT NULL, revision TEXT NOT NULL, in_trash INTEGER NOT NULL,
 position INTEGER NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX workspace_articles_location ON workspace_articles(in_trash,updated_at);
--> statement-breakpoint
CREATE TABLE workspace_works (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, genre TEXT NOT NULL,
 collection TEXT NOT NULL, characters INTEGER NOT NULL, status TEXT NOT NULL,
 object_key TEXT NOT NULL, object_sha TEXT NOT NULL, object_bytes INTEGER NOT NULL,
 header_bytes INTEGER NOT NULL, chapter_count INTEGER NOT NULL, metadata_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX workspace_works_author ON workspace_works(status,author,title);
--> statement-breakpoint
CREATE TABLE workspace_excerpts (
 id TEXT PRIMARY KEY, text TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT
);
