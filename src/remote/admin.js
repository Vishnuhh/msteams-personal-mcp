// Admin area: /admin (sign-in + dashboard), /admin/api/* (JSON for the dashboard), /admin/stats (token API).
//
// Sign-in: ADMIN_USERNAME + ADMIN_PASSWORD (Cloudflare secrets the admin sets themselves).
// Session: an HttpOnly, Secure, SameSite=Strict cookie "<expiry>.<HMAC>", valid 8 hours. The HMAC key
// includes the password, so changing the password ends every session.
// Scripts (curl, monitoring) can still use ADMIN_TOKEN as a Bearer token on /admin/stats and /admin/api/*.
import { hmacHex, safeEqual } from './crypto.js';
import { buildInsights, buildAlerts, personCsv, dayOf } from './usage.js';
import { cloudUsage } from './cloud.js';
import { TOOLS_VERSION } from '../core/tools.js';

const SESSION_HOURS = 8;
const COOKIE = 'tpm_admin';
const MIN_PASSWORD = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TEAMS_CLIENT_ID = '8ec6bc83-69c8-4392-8f08-b3c986009232';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export function adminConfigured(env) {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD && String(env.ADMIN_PASSWORD).length >= MIN_PASSWORD);
}

const sessionKey = (env) => `${env.KEY_SALT || 'msteams-personal-mcp'}|admin|${env.ADMIN_PASSWORD}`;

export async function makeSession(env, now = Date.now()) {
  const exp = now + SESSION_HOURS * 3600 * 1000;
  return `${exp}.${await hmacHex(sessionKey(env), `session|${env.ADMIN_USERNAME}|${exp}`)}`;
}

export async function validSession(env, value, now = Date.now()) {
  if (!adminConfigured(env) || typeof value !== 'string') return false;
  const [expRaw, sig] = value.split('.');
  const exp = Number(expRaw);
  if (!exp || !sig || exp < now) return false;
  return safeEqual(sig, await hmacHex(sessionKey(env), `session|${env.ADMIN_USERNAME}|${exp}`));
}

function cookieValue(request) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** True for a signed-in admin (cookie) or a script holding ADMIN_TOKEN (Bearer). */
export async function isAdmin(request, env) {
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer && env.ADMIN_TOKEN && safeEqual(bearer, String(env.ADMIN_TOKEN))) return true;
  return validSession(env, cookieValue(request));
}

export async function login(request, env, onFail) {
  if (!adminConfigured(env)) return json({ error: `Admin sign-in is not set up. Set ADMIN_USERNAME and ADMIN_PASSWORD (at least ${MIN_PASSWORD} characters) as secrets.` }, 503);
  const { username, password } = await request.json().catch(() => ({}));
  const okUser = safeEqual(String(username || ''), String(env.ADMIN_USERNAME));
  const okPass = safeEqual(String(password || ''), String(env.ADMIN_PASSWORD));
  if (!okUser || !okPass) {
    onFail?.();
    return json({ error: 'Wrong username or password.' }, 401);
  }
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${encodeURIComponent(await makeSession(env))}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`,
  });
}

export function logout() {
  return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

// ---------------------------------------------------------------- data

const KEY_RE = /^([0-9a-f]{16,64}|conn:[0-9a-f]{64})$/;

async function loadConnections(env, inactiveDays) {
  const rows = (await env.DB.prepare(
    `SELECT id, account_name, app_name, account_hash, created_at, tools_version, COALESCE(last_used_at, created_at) AS last_used FROM users ORDER BY last_used DESC`,
  ).all()).results || [];
  return rows.map((c) => ({
    id: c.id,
    accountHash: c.account_hash || null,
    person: c.account_name || null,
    app: c.app_name || null,
    createdAt: new Date(c.created_at).toISOString(),
    lastUsedAt: new Date(c.last_used).toISOString(),
    expiresAt: new Date(c.last_used + inactiveDays * DAY_MS).toISOString(),
    toolsUpToDate: (c.tools_version ?? 0) >= TOOLS_VERSION,
  }));
}

async function loadBasics(env, { inactiveDays, days = 30, now = Date.now() }) {
  const since = dayOf(now - (days - 1) * DAY_MS);
  const [connections, rows, people, limits] = await Promise.all([
    loadConnections(env, inactiveDays),
    env.DB.prepare('SELECT day, user_id, account_hash, metric, count FROM usage_daily WHERE day >= ?').bind(since).all().then((r) => r.results || []),
    env.DB.prepare('SELECT account_hash, name, first_seen, last_seen FROM people').all().then((r) => r.results || []),
    env.DB.prepare('SELECT account_hash, daily_writes FROM person_limits').all().then((r) => r.results || []),
  ]);
  // Usage rows written before the account was known are attributed to it through the connection.
  const accountOf = new Map(connections.filter((c) => c.accountHash).map((c) => [c.id, c.accountHash]));
  for (const r of rows) if (!r.account_hash && accountOf.has(r.user_id)) r.account_hash = accountOf.get(r.user_id);
  const overrides = Object.fromEntries(limits.map((l) => [l.account_hash, l.daily_writes]));
  return { connections, rows, people, overrides };
}

export async function overview(env, { version, settings, inactiveDays, dailyCap = 200, access = { restricted: false, waiting: 0 } }) {
  const now = Date.now();
  const { connections, rows, people, overrides } = await loadBasics(env, { inactiveDays, now });
  const insights = buildInsights({ rows, connections, people, now, dailyCap, overrides });
  const since14 = dayOf(now - 13 * DAY_MS);
  const stats = (await env.DB.prepare('SELECT day, metric, count FROM stats WHERE day >= ?').bind(since14).all()).results || [];
  const events = {};
  for (const s of stats) if (!s.metric.startsWith('tool:')) events[s.metric] = (events[s.metric] || 0) + s.count;
  const failedAdminToday = stats.filter((s) => s.day === dayOf(now) && s.metric === 'admin_signin_failed').reduce((n, s) => n + s.count, 0);
  const cloud = await cloudUsage(env, now).catch((e) => ({ configured: true, error: String(e.message || e).slice(0, 200) }));
  const lastCleanup = await env.DB.prepare("SELECT day FROM stats WHERE metric = 'cleanup_run' ORDER BY day DESC LIMIT 1").first();
  const todayTotals = insights.daily[insights.daily.length - 1];
  const alerts = buildAlerts({ insights, cloud: cloud?.configured && !cloud.error ? cloud : null, failedAdminSignInsToday: failedAdminToday });
  if (access.waiting) alerts.unshift({ level: 'warn', text: `${access.waiting} ${access.waiting === 1 ? 'person is' : 'people are'} waiting for an access decision. See Access.` });
  const oldTools = connections.filter((c) => !c.toolsUpToDate).length;
  if (oldTools) alerts.push({ level: 'warn', text: `${oldTools} connection${oldTools === 1 ? ' has' : 's have'} an older tool list. Claude shows those people a note to refresh the connector.` });
  if (!access.restricted) alerts.push({ level: 'warn', text: 'Access is open: any personal Microsoft account can connect. Restrict it under Access.' });
  return {
    version,
    access: { restricted: access.restricted, waiting: access.waiting },
    totals: {
      people: insights.people.length,
      activeToday: insights.adoption.activeToday,
      active7: insights.adoption.active7,
      requestsToday: todayTotals?.requests || 0,
      toolCallsToday: todayTotals?.toolCalls || 0,
      changesToday: todayTotals?.changes || 0,
      connections: connections.length,
      registeredApps: (await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients').first())?.n ?? 0,
    },
    alerts,
    cloud,
    people: insights.people,
    daily: insights.daily,
    hours: insights.hours,
    tools: insights.tools,
    adoption: insights.adoption,
    connections,
    events,
    settings,
    limits: { requestsPerMinute: 120, searchesPerMinute: 10, changesPerMinute: 10, changesPerDay: dailyCap, inactiveDays },
    lastCleanup: lastCleanup?.day || null,
    microsoft: {
      shownAs: "Microsoft Teams (Microsoft's own app, not a separate plugin)",
      clientId: TEAMS_CLIENT_ID,
      permissionsPage: 'https://account.live.com/consent/Manage',
      note: 'This server signs people in through the same Microsoft Teams app that teams.live.com uses, so Microsoft treats it as Teams, ' +
        'not as a third-party plugin. To cut off only this server, use End connection here (or teams_logout). ' +
        'Removing Teams in Microsoft account settings can also sign the person out of their normal Teams.',
    },
    privacy: 'Counts only: tool names, numbers, durations and sizes. Message text, chat names and contacts are never recorded.',
  };
}

const keyFilter = (key) => (key.startsWith('conn:') ? { sql: 'user_id = ?', arg: key.slice(5) } : { sql: 'account_hash = ?', arg: key });

export async function person(env, key, { inactiveDays, dailyCap = 200 }) {
  if (!KEY_RE.test(key || '')) return json({ error: 'Unknown person.' }, 400);
  const now = Date.now();
  const { connections, rows, people, overrides } = await loadBasics(env, { inactiveDays, now });
  const mine = rows.filter((r) => (key.startsWith('conn:') ? r.user_id === key.slice(5) && !r.account_hash : r.account_hash === key));
  const myConnections = connections.filter((c) => (key.startsWith('conn:') ? c.id === key.slice(5) : c.accountHash === key));
  const ins = buildInsights({ rows: mine, connections: myConnections, people: people.filter((p) => p.account_hash === key), now, dailyCap, overrides });
  const p = ins.people.find((x) => x.key === key) || ins.people[0] || null;
  if (!p) return json({ error: 'No usage or connections for this person yet.' }, 404);
  // Share is relative to everyone, not just this person.
  const all = rows.filter((r) => r.metric === 'request').reduce((n, r) => n + r.count, 0);
  p.share = all ? Math.round((p.totals.requests / all) * 1000) / 10 : 0;
  return json({
    person: p,
    connections: myConnections,
    daily: ins.daily,
    hours: ins.hours,
    tools: ins.tools,
    capOverride: overrides[key] ?? null,
    defaultCap: dailyCap,
  });
}

export async function personCsvResponse(env, key) {
  if (!KEY_RE.test(key || '')) return json({ error: 'Unknown person.' }, 400);
  const f = keyFilter(key);
  const rows = (await env.DB.prepare(`SELECT day, metric, count FROM usage_daily WHERE ${f.sql} ORDER BY day, metric`).bind(f.arg).all()).results || [];
  return new Response(personCsv(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="usage-${key.replace(/[^a-z0-9]/gi, '').slice(0, 12)}.csv"`, 'Cache-Control': 'no-store' },
  });
}

export async function endPerson(env, key) {
  if (!KEY_RE.test(key || '')) return json({ error: 'Unknown person.' }, 400);
  const r = key.startsWith('conn:')
    ? await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(key.slice(5)).run()
    : await env.DB.prepare('DELETE FROM users WHERE account_hash = ?').bind(key).run();
  return json({ ended: r.meta?.changes ?? 0 });
}

export async function setPersonLimit(request, env, key) {
  if (!KEY_RE.test(key || '') || key.startsWith('conn:')) return json({ error: 'Limits can be set once the person has used the server.' }, 400);
  const { dailyWrites } = await request.json().catch(() => ({}));
  if (dailyWrites === null) {
    await env.DB.prepare('DELETE FROM person_limits WHERE account_hash = ?').bind(key).run();
    return json({ ok: true, dailyWrites: null });
  }
  const n = Number(dailyWrites);
  if (!Number.isInteger(n) || n < 0 || n > 5000) return json({ error: 'Daily changes must be a whole number from 0 to 5000.' }, 400);
  await env.DB.prepare('INSERT INTO person_limits (account_hash, daily_writes) VALUES (?, ?) ON CONFLICT(account_hash) DO UPDATE SET daily_writes = excluded.daily_writes').bind(key, n).run();
  return json({ ok: true, dailyWrites: n });
}

export async function endConnection(env, id) {
  if (!/^[0-9a-f]{64}$/.test(id || '')) return json({ error: 'Unknown connection.' }, 400);
  const r = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return json({ ended: (r.meta?.changes ?? 0) > 0 });
}

// The page itself lives in admin-page.js.
export { renderAdminPage } from './admin-page.js';
