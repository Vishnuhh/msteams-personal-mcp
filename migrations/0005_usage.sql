-- v0.8.0: per-person usage counts (numbers only — never message text, chat names or contacts).
-- One row per day, connection and metric. Metrics: request, tool:<name>, ms:<tool>, kb:<tool>, error:<tool>,
-- write, heavy, rate_limited, throttled, teams_call, hour:<HH>.
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  account_hash TEXT,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id, metric)
);
CREATE INDEX IF NOT EXISTS usage_daily_account ON usage_daily (account_hash, day);

-- People seen by this server (kept after their connections end, so history keeps a name).
CREATE TABLE IF NOT EXISTS people (
  account_hash TEXT PRIMARY KEY,
  name TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- Per-person override of the daily change cap (account_hash = keyed hash of the Teams account).
CREATE TABLE IF NOT EXISTS person_limits (
  account_hash TEXT PRIMARY KEY,
  daily_writes INTEGER NOT NULL
);
