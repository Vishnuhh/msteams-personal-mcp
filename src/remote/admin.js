// Admin data: /admin/api/* JSON for the dashboard. Sign-in, sessions and the audit log live in admin-auth.js;
// the page itself in admin-page.js. Every list is paged on the server (page, size, q).
import { buildInsights, buildAlerts, personCsv, dayOf } from './usage.js';
import { cloudUsage } from './cloud.js';
import { TOOLS_VERSION } from '../core/tools.js';
import { issueDays } from './diagnostics.js';

export { adminConfigured, MIN_PASSWORD } from './admin-auth.js';
export { renderAdminPage } from './admin-page.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const TEAMS_CLIENT_ID = '8ec6bc83-69c8-4392-8f08-b3c986009232';
const KEY_RE = /^([0-9a-f]{16,64}|conn:[0-9a-f]{64})$/;
const TAGS = ['team', 'customer', 'other'];

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

/** { page, size, q } from a URL: size 1-50 (default 10), page from 1, q trimmed to 80 characters. */
export function paging(url, defaultSize = 10) {
  const p = url.searchParams;
  const size = Math.min(50, Math.max(1, Number(p.get('size')) || defaultSize));
  const page = Math.max(1, Math.floor(Number(p.get('page')) || 1));
  return { page, size, q: String(p.get('q') || '').trim().slice(0, 80) };
}
export const pageOf = (items, { page, size }) => ({ items: items.slice((page - 1) * size, page * size), total: items.length, page, size });

async function loadConnections(env, inactiveDays) {
  const rows = (await env.DB.prepare(
    'SELECT id, account_name, app_name, account_hash, created_at, tools_version, COALESCE(last_used_at, created_at) AS last_used FROM users ORDER BY last_used DESC',
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
  const [connections, rows, people, limits, meta] = await Promise.all([
    loadConnections(env, inactiveDays),
    env.DB.prepare('SELECT day, user_id, account_hash, metric, count FROM usage_daily WHERE day >= ?').bind(since).all().then((r) => r.results || []),
    env.DB.prepare('SELECT account_hash, name, first_seen, last_seen FROM people').all().then((r) => r.results || []),
    env.DB.prepare('SELECT account_hash, daily_writes FROM person_limits').all().then((r) => r.results || []),
    env.DB.prepare('SELECT account_hash, tag, org, note FROM person_meta').all().then((r) => r.results || []).catch(() => []),
  ]);
  // Usage rows written before the account was known are attributed to it through the connection.
  const accountOf = new Map(connections.filter((c) => c.accountHash).map((c) => [c.id, c.accountHash]));
  for (const r of rows) if (!r.account_hash && accountOf.has(r.user_id)) r.account_hash = accountOf.get(r.user_id);
  const overrides = Object.fromEntries(limits.map((l) => [l.account_hash, l.daily_writes]));
  return { connections, rows, people, overrides, meta: new Map(meta.map((m) => [m.account_hash, m])) };
}

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

export async function overview(env, { version, settings, access = { restricted: false, waiting: 0 } }) {
  const now = Date.now();
  const inactiveDays = settings.inactiveDays;
  const { connections, rows, people, overrides } = await loadBasics(env, { inactiveDays, now });
  const insights = buildInsights({ rows, connections, people, now, dailyCap: settings.dailyCap, overrides });
  const since14 = dayOf(now - 13 * DAY_MS);
  const stats = (await env.DB.prepare('SELECT day, metric, count FROM stats WHERE day >= ?').bind(since14).all()).results || [];
  const events = {};
  for (const s of stats) if (!s.metric.startsWith('tool:')) events[s.metric] = (events[s.metric] || 0) + s.count;
  const failedAdminToday = stats.filter((s) => s.day === dayOf(now) && s.metric === 'admin_signin_failed').reduce((n, s) => n + s.count, 0);
  const cloud = await cloudUsage(env, now).catch((e) => ({ configured: true, error: String(e.message || e).slice(0, 200) }));
  const lastCleanup = await env.DB.prepare("SELECT day FROM stats WHERE metric = 'cleanup_run' ORDER BY day DESC LIMIT 1").first();
  const today = insights.daily[insights.daily.length - 1] || {};
  const yesterday = insights.daily[insights.daily.length - 2] || {};
  const alerts = buildAlerts({ insights, cloud: cloud?.configured && !cloud.error ? cloud : null, failedAdminSignInsToday: failedAdminToday });
  if (access.waiting) alerts.unshift({ level: 'warn', text: `${access.waiting} ${access.waiting === 1 ? 'person is' : 'people are'} waiting for an access decision.`, link: '#access/requests' });
  const oldTools = connections.filter((c) => !c.toolsUpToDate).length;
  if (oldTools) alerts.push({ level: 'warn', text: `${oldTools} connection${oldTools === 1 ? ' has' : 's have'} an older tool list. Claude shows those people a note to refresh the connector.`, link: '#connections/refresh' });
  if (!access.restricted) alerts.push({ level: 'warn', text: 'Access is open: any personal Microsoft account can connect.', link: '#access' });
  const issues = await issueDays(env, now).catch(() => ({ days: [], today: 0 }));
  return {
    version,
    access: { restricted: access.restricted, waiting: access.waiting },
    issueDays: issues.days,
    issuesToday: issues.today,
    totals: {
      people: insights.people.length,
      activeToday: insights.adoption.activeToday,
      active7: insights.adoption.active7,
      requestsToday: today.requests || 0,
      toolCallsToday: today.toolCalls || 0,
      changesToday: today.changes || 0,
      connections: connections.length,
      oldTools,
      registeredApps: (await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients').first())?.n ?? 0,
    },
    vsYesterday: {
      requestsToday: pct(today.requests || 0, yesterday.requests || 0),
      toolCallsToday: pct(today.toolCalls || 0, yesterday.toolCalls || 0),
      changesToday: pct(today.changes || 0, yesterday.changes || 0),
    },
    alerts,
    cloud,
    topPeople: insights.people.slice(0, 5).map((p) => ({ key: p.key, name: p.name, share: p.share })),
    daily: insights.daily,
    hours: insights.hours,
    tools: insights.tools,
    adoption: insights.adoption,
    events,
    settings,
    limits: { requestsPerMinute: 120, searchesPerMinute: 10, changesPerMinute: 10, changesPerDay: settings.dailyCap, inactiveDays },
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

const SORTS = {
  requests: (p) => p.totals.requests, toolCalls: (p) => p.totals.toolCalls, changes: (p) => p.totals.changes,
  errors: (p) => p.totals.errors, lastActive: (p) => p.lastActive || '', name: (p) => (p.name || '').toLowerCase(),
};

/** GET /admin/api/people?q=&tag=&sort=&dir=&page=&size= */
export async function peopleList(env, url, { settings }) {
  const pg = paging(url);
  const sort = SORTS[url.searchParams.get('sort')] ? url.searchParams.get('sort') : 'requests';
  const dir = url.searchParams.get('dir') === 'asc' ? 1 : -1;
  const tag = TAGS.includes(url.searchParams.get('tag')) ? url.searchParams.get('tag') : null;
  const { connections, rows, people, overrides, meta } = await loadBasics(env, { inactiveDays: settings.inactiveDays });
  const insights = buildInsights({ rows, connections, people, dailyCap: settings.dailyCap, overrides });
  let list = insights.people.map((p) => ({ ...p, tag: meta.get(p.key)?.tag || null, org: meta.get(p.key)?.org || null }));
  if (tag) list = list.filter((p) => p.tag === tag);
  if (pg.q) { const q = pg.q.toLowerCase(); list = list.filter((p) => `${p.name || ''} ${p.org || ''} ${p.apps.join(' ')}`.toLowerCase().includes(q)); }
  list.sort((a, b) => (SORTS[sort](a) > SORTS[sort](b) ? 1 : SORTS[sort](a) < SORTS[sort](b) ? -1 : 0) * dir);
  const counts = Object.fromEntries(TAGS.map((t) => [t, insights.people.filter((p) => meta.get(p.key)?.tag === t).length]));
  return json({ ...pageOf(list, pg), sort, dir: dir === 1 ? 'asc' : 'desc', tag, counts, all: insights.people.length, privacy: 'Counts only: tool names, numbers, durations and sizes. Message text, chat names and contacts are never recorded.' });
}

/** GET /admin/api/connections?q=&filter=refresh&page=&size= */
export async function connectionsList(env, url, { settings }) {
  const pg = paging(url);
  const onlyOld = url.searchParams.get('filter') === 'refresh';
  let list = await loadConnections(env, settings.inactiveDays);
  const counts = { all: list.length, refresh: list.filter((c) => !c.toolsUpToDate).length };
  if (onlyOld) list = list.filter((c) => !c.toolsUpToDate);
  if (pg.q) { const q = pg.q.toLowerCase(); list = list.filter((c) => `${c.person || ''} ${c.app || ''}`.toLowerCase().includes(q)); }
  return json({ ...pageOf(list, pg), filter: onlyOld ? 'refresh' : 'all', counts });
}

const keyFilter = (key) => (key.startsWith('conn:') ? { sql: 'user_id = ?', arg: key.slice(5) } : { sql: 'account_hash = ?', arg: key });

/** One person: usage when there is some, and always who they are, their access and the admin's notes. */
export async function person(env, key, { settings }) {
  if (!KEY_RE.test(key || '')) return json({ error: 'Unknown person.' }, 400);
  const now = Date.now();
  const { connections, rows, people, overrides, meta } = await loadBasics(env, { inactiveDays: settings.inactiveDays, now });
  const mine = rows.filter((r) => (key.startsWith('conn:') ? r.user_id === key.slice(5) && !r.account_hash : r.account_hash === key));
  const myConnections = connections.filter((c) => (key.startsWith('conn:') ? c.id === key.slice(5) : c.accountHash === key));
  const ins = buildInsights({ rows: mine, connections: myConnections, people: people.filter((p) => p.account_hash === key), now, dailyCap: settings.dailyCap, overrides });
  const accessRow = key.startsWith('conn:') ? null : await env.DB.prepare('SELECT status, name, via, updated_at FROM access_people WHERE account_hash = ?').bind(key).first().catch(() => null);
  const known = people.find((p) => p.account_hash === key);
  let p = ins.people.find((x) => x.key === key) || ins.people[0] || null;
  if (!p && !accessRow && !known) return json({ error: 'This person is not known to the server.' }, 404);
  const noUsage = !p;
  if (!p) {
    const zero = { requests: 0, toolCalls: 0, changes: 0, searches: 0, errors: 0, rateLimited: 0, throttled: 0, teamsCalls: 0, kb: 0, ms: 0 };
    p = { key, name: known?.name || accessRow?.name || null, totals: zero, today: { ...zero }, apps: [], connections: 0, activeDays: 0, share: 0,
      firstConnected: known ? new Date(known.first_seen).toISOString() : null, lastActive: null, dailyCap: overrides[key] ?? settings.dailyCap, capUsedToday: 0 };
  }
  const all = rows.filter((r) => r.metric === 'request').reduce((n, r) => n + r.count, 0);
  p.share = all ? Math.round((p.totals.requests / all) * 1000) / 10 : 0;
  return json({
    person: p, noUsage,
    access: accessRow ? { status: accessRow.status, via: accessRow.via, since: new Date(accessRow.updated_at).toISOString() } : null,
    meta: meta.get(key) ? { tag: meta.get(key).tag, org: meta.get(key).org, note: meta.get(key).note } : { tag: null, org: null, note: null },
    connections: myConnections,
    daily: ins.daily, hours: ins.hours, tools: ins.tools,
    capOverride: overrides[key] ?? null,
    defaultCap: settings.dailyCap,
  });
}

/** POST /admin/api/person/<key>/meta { tag, org, note } */
export async function setPersonMeta(request, env, key) {
  if (!/^[0-9a-f]{64}$/.test(key || '')) return json({ error: 'Unknown person.' }, 400);
  const body = await request.json().catch(() => ({}));
  const tag = body.tag === null || body.tag === '' ? null : String(body.tag);
  if (tag && !TAGS.includes(tag)) return json({ error: 'Tag must be team, customer or other.' }, 400);
  const clean = (s, n) => (s === null || s === undefined ? null : String(s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) || null);
  const org = clean(body.org, 80), note = clean(body.note, 500);
  await env.DB.prepare('INSERT INTO person_meta (account_hash, tag, org, note, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_hash) DO UPDATE SET tag = excluded.tag, org = excluded.org, note = excluded.note, updated_at = excluded.updated_at')
    .bind(key, tag, org, note, Date.now()).run();
  return json({ ok: true, meta: { tag, org, note } });
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
  if (!/^[0-9a-f]{64}$/.test(key || '')) return json({ error: 'Limits can be set for a known Teams account only.' }, 400);
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
