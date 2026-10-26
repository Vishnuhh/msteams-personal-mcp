// Admin sign-in, sessions, two-factor codes and the audit log.
//
// Sign-in: ADMIN_USERNAME + ADMIN_PASSWORD (Cloudflare secrets), plus a 6-digit authenticator code once two-factor
// is turned on (Settings > Security). The session cookie holds a random token; D1 stores only its SHA-256 with
// the time it was created and last used. A session ends after 30 minutes without use, 8 hours in total, on sign-out
// (server side, so a copied cookie stops working too), or when the admin password changes.
// ADMIN_TOKEN (optional, for scripts) is read-only: it works for GET requests only.
import { hmacHex, safeEqual, newSecret, sha256Hex, sealJson, openJson } from './crypto.js';
import { newTotpSecret, totpStep, otpauthUri } from './totp.js';

const COOKIE = 'tpm_admin';
export const MIN_PASSWORD = 12;
const ABSOLUTE_MS = 8 * 3600 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const AUDIT_DAYS = 180;
const TOTP_INFO = 'admin-totp-v1';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const salt = (env) => env.KEY_SALT || 'msteams-personal-mcp';
const pwPrint = (env) => hmacHex(salt(env), `admin-password|${env.ADMIN_USERNAME}|${env.ADMIN_PASSWORD}`);
const totpSecretKey = (env) => `${salt(env)}|admin-totp`;
const setting = async (env, key) => (await env.DB.prepare('SELECT value FROM access_settings WHERE key = ?').bind(key).first())?.value ?? null;
const putSetting = (env, key, value) => env.DB.prepare('INSERT INTO access_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);

export function adminConfigured(env) {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD && String(env.ADMIN_PASSWORD).length >= MIN_PASSWORD);
}

function cookieValue(request) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---------------------------------------------------------------- two-factor

async function totpSecret(env) {
  const sealed = await setting(env, 'admin_totp');
  if (!sealed) return null;
  try { return (await openJson(totpSecretKey(env), salt(env), TOTP_INFO, sealed)).secret; } catch { return null; }
}

/** Checks a code and refuses a code that was already used (one sign-in per 30-second step). */
async function useTotp(env, secret, code, now = Date.now()) {
  const step = await totpStep(secret, code, now);
  if (step === null) return false;
  const last = Number(await setting(env, 'admin_totp_last')) || 0;
  if (step <= last) return false;
  await putSetting(env, 'admin_totp_last', String(step)).run();
  return true;
}

export async function twoFactorStatus(env) {
  return { enabled: Boolean(await setting(env, 'admin_totp')), pending: Boolean(await setting(env, 'admin_totp_pending')) };
}

export async function startTwoFactor(env) {
  const secret = newTotpSecret();
  await putSetting(env, 'admin_totp_pending', await sealJson(totpSecretKey(env), salt(env), TOTP_INFO, { secret })).run();
  return json({ secret, uri: otpauthUri(secret, env.ADMIN_USERNAME || 'admin', 'Teams Personal MCP') });
}

export async function confirmTwoFactor(request, env) {
  const { code } = await request.json().catch(() => ({}));
  const sealed = await setting(env, 'admin_totp_pending');
  if (!sealed) return json({ error: 'Start the set-up again.' }, 400);
  const { secret } = await openJson(totpSecretKey(env), salt(env), TOTP_INFO, sealed);
  if (!(await useTotp(env, secret, code))) return json({ error: 'That code is not right. Check the time on your phone and try the newest code.' }, 400);
  await env.DB.batch([putSetting(env, 'admin_totp', sealed), env.DB.prepare("DELETE FROM access_settings WHERE key = 'admin_totp_pending'")]);
  return json({ ok: true });
}

export async function disableTwoFactor(request, env) {
  const { code } = await request.json().catch(() => ({}));
  const secret = await totpSecret(env);
  if (!secret) return json({ error: 'Two-factor is not on.' }, 400);
  if (!(await useTotp(env, secret, code))) return json({ error: 'That code is not right.' }, 400);
  await env.DB.prepare("DELETE FROM access_settings WHERE key IN ('admin_totp', 'admin_totp_pending')").run();
  return json({ ok: true });
}

// ---------------------------------------------------------------- sign-in and sessions

/** POST /admin/login { username, password, code? }. Returns { response, ok, sessionId }. */
export async function login(request, env, { onFail, country = null, agent = null, now = Date.now() } = {}) {
  if (!adminConfigured(env)) {
    return { response: json({ error: `Admin sign-in is not set up. Set ADMIN_USERNAME and ADMIN_PASSWORD (at least ${MIN_PASSWORD} characters) as secrets.` }, 503) };
  }
  const { username, password, code } = await request.json().catch(() => ({}));
  const okUser = safeEqual(String(username || ''), String(env.ADMIN_USERNAME));
  const okPass = safeEqual(String(password || ''), String(env.ADMIN_PASSWORD));
  if (!okUser || !okPass) {
    onFail?.('password');
    return { response: json({ error: 'Wrong username or password.' }, 401) };
  }
  const secret = await totpSecret(env);
  if (secret) {
    if (!code) return { response: json({ needCode: true, error: 'Enter the 6-digit code from your authenticator app.' }, 401) };
    if (!(await useTotp(env, secret, code, now))) {
      onFail?.('code');
      return { response: json({ needCode: true, error: 'That code is not right, or it was already used. Try the newest code.' }, 401) };
    }
  }
  const token = newSecret('ses');
  const id = await sha256Hex(token);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ? OR last_seen < ?').bind(now, now - IDLE_MS),
    env.DB.prepare('INSERT INTO admin_sessions (id, created_at, last_seen, expires_at, pw, country, agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, now, now, now + ABSOLUTE_MS, await pwPrint(env), country, String(agent || '').slice(0, 120) || null),
  ]);
  return { ok: true, sessionId: id, response: json({ ok: true }, 200, { 'Set-Cookie': cookie(encodeURIComponent(token), ABSOLUTE_MS / 1000) }) };
}

/**
 * Who is asking: { ok: true, via: 'session', sessionId } for a signed-in admin, { ok: true, via: 'token' } for
 * ADMIN_TOKEN on a GET request, otherwise { ok: false }.
 */
export async function adminFrom(request, env, now = Date.now()) {
  if (!adminConfigured(env)) return { ok: false };
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) {
    const tokenOk = env.ADMIN_TOKEN && safeEqual(bearer, String(env.ADMIN_TOKEN));
    return tokenOk && request.method === 'GET' ? { ok: true, via: 'token' } : { ok: false, readOnly: Boolean(tokenOk) };
  }
  const token = cookieValue(request);
  if (!token || !/^ses_[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false };
  const id = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT id, last_seen, expires_at, pw FROM admin_sessions WHERE id = ?').bind(id).first();
  if (!row || row.expires_at < now || now - row.last_seen > IDLE_MS || !safeEqual(row.pw, await pwPrint(env))) {
    if (row) await env.DB.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(id).run();
    return { ok: false, expired: Boolean(row) };
  }
  if (now - row.last_seen > TOUCH_EVERY_MS) await env.DB.prepare('UPDATE admin_sessions SET last_seen = ? WHERE id = ?').bind(now, id).run();
  return { ok: true, via: 'session', sessionId: id };
}

export async function logout(request, env) {
  const token = cookieValue(request);
  if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}

export async function listSessions(env, currentId, now = Date.now()) {
  const rows = (await env.DB.prepare('SELECT id, created_at, last_seen, expires_at, country, agent FROM admin_sessions WHERE expires_at >= ? AND last_seen >= ? ORDER BY last_seen DESC')
    .bind(now, now - IDLE_MS).all()).results || [];
  return rows.map((r) => ({
    id: r.id.slice(0, 16), current: r.id === currentId, createdAt: new Date(r.created_at).toISOString(), lastSeen: new Date(r.last_seen).toISOString(),
    endsAt: new Date(Math.min(r.expires_at, r.last_seen + IDLE_MS)).toISOString(), country: r.country, agent: r.agent,
  }));
}

/** Ends one session (by the 16-character id the list shows) or every other session. */
export async function endSessions(env, { id = null, allExcept = null }) {
  if (allExcept) {
    const r = await env.DB.prepare('DELETE FROM admin_sessions WHERE id != ?').bind(allExcept).run();
    return json({ ended: r.meta?.changes ?? 0 });
  }
  if (!/^[0-9a-f]{16}$/.test(id || '')) return json({ error: 'Unknown session.' }, 400);
  const r = await env.DB.prepare("DELETE FROM admin_sessions WHERE substr(id, 1, 16) = ?").bind(id).run();
  return json({ ended: r.meta?.changes ?? 0 });
}

// ---------------------------------------------------------------- audit log

/** Records an admin action. Never fails the caller. */
export function audit(env, ctx, { action, target = null, detail = null, sessionId = null, country = null }) {
  const p = env.DB.prepare('INSERT INTO admin_audit (at, action, target, detail, session, country) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), action, target ? String(target).slice(0, 120) : null, detail ? String(detail).slice(0, 300) : null, sessionId ? sessionId.slice(0, 16) : null, country)
    .run().catch(() => {});
  ctx?.waitUntil?.(p);
  return p;
}

export async function auditLog(env, { page = 1, size = 20, q = '' } = {}) {
  const like = `%${String(q).slice(0, 60)}%`;
  const where = q ? 'WHERE action LIKE ? OR target LIKE ? OR detail LIKE ?' : '';
  const args = q ? [like, like, like] : [];
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit ${where}`).bind(...args).first())?.n ?? 0;
  const rows = (await env.DB.prepare(`SELECT at, action, target, detail, session, country FROM admin_audit ${where} ORDER BY at DESC LIMIT ? OFFSET ?`)
    .bind(...args, size, (page - 1) * size).all()).results || [];
  return { items: rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })), total, page, size };
}

export const auditCleanup = (env, now = Date.now()) => [
  env.DB.prepare('DELETE FROM admin_audit WHERE at < ?').bind(now - AUDIT_DAYS * 86400e3),
  env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ? OR last_seen < ?').bind(now, now - IDLE_MS),
];
