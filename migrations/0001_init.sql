-- Latest normalised readings: one JSON document per layer.
-- Kept as a single row per layer so a cron run costs one row write, not thousands
-- (D1 free tier allows 100k row writes per day).
CREATE TABLE snapshots (
  layer      TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  body       TEXT NOT NULL
);

-- Fetch status per source, shown on the "Source status" page.
CREATE TABLE source_status (
  source               TEXT PRIMARY KEY,
  last_attempt_at      TEXT,
  last_success_at      TEXT,
  last_error_at        TEXT,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  item_count           INTEGER,
  duration_ms          INTEGER
);

-- Error log (failures and recoveries only), pruned after 7 days.
CREATE TABLE fetch_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  at          TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  message     TEXT,
  duration_ms INTEGER
);
CREATE INDEX fetch_log_at ON fetch_log (at);

-- Short history (7 days) for sensors whose upstream has no history endpoint.
CREATE TABLE history (
  id    TEXT NOT NULL,
  ts    INTEGER NOT NULL, -- unix seconds
  value REAL,
  PRIMARY KEY (id, ts)
) WITHOUT ROWID;

-- On-demand upstream responses (point forecasts, station graphs).
-- Rows are kept past expiry so the last good answer can be served, marked stale,
-- when the upstream fails.
CREATE TABLE cache (
  key        TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL, -- unix seconds
  body       TEXT NOT NULL
);
CREATE INDEX cache_expires ON cache (expires_at);

-- Binary objects (latest radar frame).
CREATE TABLE blobs (
  key        TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  meta       TEXT NOT NULL,
  body       BLOB NOT NULL
);
