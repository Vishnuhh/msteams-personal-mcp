-- OAuth 2.1 for MCP clients (Claude connectors, Claude Code, Cursor, ...).

-- Dynamically registered clients (RFC 7591). Public clients only (PKCE, no secret).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,      -- JSON array
  created_at INTEGER NOT NULL
);

-- Authorization requests waiting for the user to sign in at Microsoft (short-lived).
-- id = SHA-256(request id held by the browser); data = the validated /authorize parameters (no secrets).
CREATE TABLE IF NOT EXISTS oauth_requests (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Authorization codes (single use, 10 minutes). id = SHA-256(code);
-- data = the new user's access key and the request it answers, sealed under HKDF(code).
CREATE TABLE IF NOT EXISTS oauth_codes (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_requests_expires_at ON oauth_requests (expires_at);
CREATE INDEX IF NOT EXISTS oauth_codes_expires_at ON oauth_codes (expires_at);
