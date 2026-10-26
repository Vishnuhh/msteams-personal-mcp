-- Issue events for the admin page's root-cause view: Microsoft slow-downs, tool errors, refused calls and
-- sign-ins. Details are short and scrubbed of chat ids, person ids, links and emails. Kept 14 days.
CREATE TABLE IF NOT EXISTS diag_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  account_hash TEXT,
  user_id TEXT,
  tool TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS diag_events_day_kind ON diag_events (day, kind);
CREATE INDEX IF NOT EXISTS diag_events_account ON diag_events (account_hash, at);
