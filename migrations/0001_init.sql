-- Users: id = SHA-256(access key); data = AES-GCM(refresh token + cached skypetoken) under HKDF(access key).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Pending device-code sign-ins (short-lived): id = SHA-256(login id); device code sealed under HKDF(login id).
CREATE TABLE IF NOT EXISTS logins (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  interval_s INTEGER NOT NULL,
  next_poll_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS logins_expires_at ON logins (expires_at);
