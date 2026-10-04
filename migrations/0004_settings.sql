-- Admin-editable settings, such as the LINE message templates. One JSON value per key.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
