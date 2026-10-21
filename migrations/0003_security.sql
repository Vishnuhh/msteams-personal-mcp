-- v0.7.0: expiry of unused connections, "sign out everywhere", per-person daily write cap, admin counters.

-- Last day a connection was used (date-level precision is enough; updated at most once a day).
ALTER TABLE users ADD COLUMN last_used_at INTEGER;
-- Keyed hash of the Teams account id (HMAC with the server secret), to end every connection of one account.
ALTER TABLE users ADD COLUMN account_hash TEXT;
CREATE INDEX IF NOT EXISTS users_account_hash ON users (account_hash);
CREATE INDEX IF NOT EXISTS users_last_used_at ON users (last_used_at);

-- Registered apps that never come back are cleaned up.
ALTER TABLE oauth_clients ADD COLUMN last_used_at INTEGER;

-- Writes (send, reply, react, edit, delete, group changes) per connection per UTC day.
CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  writes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Anonymous daily counters for the admin view (no ids, names or messages).
CREATE TABLE IF NOT EXISTS stats (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);
