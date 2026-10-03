-- LINE rain alerts: one row per send attempt (a few per day at most).
CREATE TABLE alert_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at TEXT NOT NULL,    -- ISO, UTC
  kind    TEXT NOT NULL,    -- 'alert' or 'quota' (the one "monthly limit reached" notice)
  areas   TEXT NOT NULL,    -- area ids, comma separated
  message TEXT NOT NULL,
  ok      INTEGER NOT NULL,
  error   TEXT
);
CREATE INDEX alert_log_sent ON alert_log (sent_at);
