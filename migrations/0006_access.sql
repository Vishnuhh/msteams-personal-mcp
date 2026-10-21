-- Who may use the server: Teams group chats whose members get in, invite links, and a per-account status.
-- Accounts are identified by their HMAC account hash (as in usage_daily), never by the raw Teams id.

CREATE TABLE IF NOT EXISTS access_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Group chats whose members are let in automatically (checked at sign-in and once a day after).
CREATE TABLE IF NOT EXISTS access_groups (
  conversation_id TEXT PRIMARY KEY,
  name TEXT,
  added_at INTEGER NOT NULL
);

-- Invite links: the row id is SHA-256 of the invite code, which is shown to the admin once.
CREATE TABLE IF NOT EXISTS access_invites (
  id TEXT PRIMARY KEY,
  label TEXT,
  uses_left INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- status: member (via a group, re-checked daily), approved (invite or admin), review (connected before
-- access was restricted; keeps working until the admin decides), pending (asked, refused), blocked.
CREATE TABLE IF NOT EXISTS access_people (
  account_hash TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  name TEXT,
  via TEXT,
  checked_day TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS access_people_status ON access_people (status);

-- Access is restricted from now on; connections made before this moment go to review instead of being cut off.
INSERT OR IGNORE INTO access_settings (key, value) VALUES ('restricted_since', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
