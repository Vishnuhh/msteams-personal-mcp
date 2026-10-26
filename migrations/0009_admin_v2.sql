-- Admin v2: server-side sessions, an audit log of admin actions, people tags and notes, and a cache of the
-- admin's own group chats (so the group picker pages through a stored list instead of re-reading Teams).

-- Sessions: the cookie holds a random token; only its SHA-256 is stored. pw = a fingerprint of the admin
-- password at sign-in, so changing the password still ends every session.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  pw TEXT NOT NULL,
  country TEXT,
  agent TEXT
);

-- Who did what in the admin area, and when (kept 180 days).
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  session TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at);

-- Admin-only labels for a person: team / customer / other, an organisation and a note.
CREATE TABLE IF NOT EXISTS person_meta (
  account_hash TEXT PRIMARY KEY,
  tag TEXT,
  org TEXT,
  note TEXT,
  updated_at INTEGER NOT NULL
);

-- The admin's group chats, read from Teams on demand and paged from here.
CREATE TABLE IF NOT EXISTS admin_group_cache (
  conversation_id TEXT PRIMARY KEY,
  title TEXT,
  last_active TEXT,
  last_from TEXT,
  fetched_at INTEGER NOT NULL
);
