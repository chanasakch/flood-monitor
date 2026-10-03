-- People who follow the LINE account, learned from webhook events (follow, message).
-- LINE does not let unverified accounts download their follower list, so this is the only way
-- to offer "choose who to send to". Visible to the admin only.
CREATE TABLE line_users (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT,
  following    INTEGER NOT NULL DEFAULT 1,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);

-- Failed admin logins, for lockout. Pruned with the other logs.
CREATE TABLE login_failures (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  ip  TEXT NOT NULL,
  at  INTEGER NOT NULL -- unix seconds
);
CREATE INDEX login_failures_at ON login_failures (at);

-- How many LINE messages each send used (broadcast = followers, multicast = chosen people).
ALTER TABLE alert_log ADD COLUMN recipients INTEGER;
