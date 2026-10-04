-- Our own count of calls to third-party services that publish no usage API (Longdo Map search).
-- One row per calendar month (Thai time) and service.
CREATE TABLE usage (
  month   TEXT NOT NULL,   -- YYYY-MM
  service TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, service)
) WITHOUT ROWID;
