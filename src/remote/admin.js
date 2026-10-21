// Admin area: /admin (sign-in + dashboard), /admin/api/* (JSON for the dashboard), /admin/stats (token API).
//
// Sign-in: ADMIN_USERNAME + ADMIN_PASSWORD (Cloudflare secrets the admin sets themselves).
// Session: an HttpOnly, Secure, SameSite=Strict cookie "<expiry>.<HMAC>", valid 8 hours. The HMAC key
// includes the password, so changing the password ends every session.
// Scripts (curl, monitoring) can still use ADMIN_TOKEN as a Bearer token on /admin/stats and /admin/api/*.
import { hmacHex, safeEqual } from './crypto.js';
import { buildInsights, buildAlerts, personCsv, dayOf } from './usage.js';
import { cloudUsage } from './cloud.js';

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
    `SELECT id, account_name, app_name, account_hash, created_at, COALESCE(last_used_at, created_at) AS last_used FROM users ORDER BY last_used DESC`,
  ).all()).results || [];
  return rows.map((c) => ({
    id: c.id,
    accountHash: c.account_hash || null,
    person: c.account_name || null,
    app: c.app_name || null,
    createdAt: new Date(c.created_at).toISOString(),
    lastUsedAt: new Date(c.last_used).toISOString(),
    expiresAt: new Date(c.last_used + inactiveDays * DAY_MS).toISOString(),
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

export async function overview(env, { version, settings, inactiveDays, dailyCap = 200 }) {
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
  return {
    version,
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
    alerts: buildAlerts({ insights, cloud: cloud?.configured && !cloud.error ? cloud : null, failedAdminSignInsToday: failedAdminToday }),
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

// ---------------------------------------------------------------- page

const CSS = `
:root { --bg:#ffffff; --surface:#f2f2f2; --surface-2:#e6e6e6; --ink:#0a0a0a; --muted:#5c5c5c; --accent:#d92b21; --accent-press:#b8231b; --accent-ink:#ffffff;
  --warn:#9a6700; --step-small: 0.875rem; --step-body: 1rem; --step-head: clamp(1.75rem, 1.2rem + 2vw, 2.75rem); --step-num: clamp(1.5rem, 1.1rem + 1.4vw, 2.25rem);
  --margin: clamp(16px, 2.2vw, 32px); --radius: 4px; --ease: cubic-bezier(.2,.7,.2,1);
  --font: "Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 var(--step-body)/1.5 var(--font); }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; }
[hidden] { display: none !important; }
.nav { display: flex; justify-content: space-between; align-items: center; padding: 16px var(--margin); }
.nav .word { font-weight: 600; letter-spacing: -0.03em; text-decoration: none; }
.nav .right { display: flex; gap: 18px; align-items: center; font-size: var(--step-small); }
.btn { font: 500 var(--step-body)/1 var(--font); background: var(--accent); color: var(--accent-ink); border: 0; border-radius: var(--radius); padding: .8em 1.1em; cursor: pointer; transition: background-color .15s, transform .15s; }
.btn:hover { background: var(--accent-press); }
.btn:active { transform: scale(.97); }
.btn.quiet { background: var(--surface); color: var(--ink); }
.btn.quiet:hover { background: var(--surface-2); }
.link { font: inherit; background: none; border: 0; padding: 0; cursor: pointer; color: var(--muted); text-decoration: underline; text-underline-offset: .2em; }
.link:hover { color: var(--ink); }
main { padding: 8px var(--margin) 64px; display: grid; gap: 44px; }
h1 { margin: 0; font-size: var(--step-head); font-weight: 600; letter-spacing: -0.04em; line-height: 1; }
h2 { margin: 0 0 12px; font-size: 1.2rem; font-weight: 600; letter-spacing: -0.02em; }
.muted { color: var(--muted); font-size: var(--step-small); margin: 0; }
.signin { max-width: 380px; margin: 12vh auto 0; display: grid; gap: 14px; }
.signin label { font-size: var(--step-small); color: var(--muted); display: grid; gap: 6px; }
.signin input, .cap input { font: 500 var(--step-body)/1.2 var(--font); padding: .7em .9em; border: 0; border-radius: var(--radius); background: var(--surface); color: var(--ink); }
.err { color: var(--accent); font-size: var(--step-small); min-height: 1.4em; margin: 0; }
.alerts { display: grid; gap: 6px; }
.alert { padding: 10px 14px; border-radius: var(--radius); background: #fff4d6; color: #5c3d00; font-size: var(--step-small); }
.alert.bad { background: #fde3e1; color: #7a1712; }
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; }
.kpi { background: var(--surface); padding: 14px 16px; }
.kpi b { display: block; font-size: var(--step-num); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--muted); font-size: var(--step-small); }
table { width: 100%; border-collapse: collapse; font-size: var(--step-small); }
th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px 10px; background: var(--surface); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid var(--surface-2); vertical-align: middle; font-variant-numeric: tabular-nums; }
td.num, th.num { text-align: right; }
td .open { font: 600 var(--step-small)/1.2 var(--font); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: .2em; text-align: left; }
td .end { font: 500 var(--step-small)/1 var(--font); background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: .2em; }
.share { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.share i { display: block; height: 8px; background: var(--ink); border-radius: 2px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
.cols { display: flex; align-items: flex-end; gap: 3px; height: 120px; border-bottom: 1px solid var(--surface-2); }
.cols i { flex: 1; background: var(--ink); min-height: 1px; border-radius: 2px 2px 0 0; position: relative; }
.cols i.w { background: var(--accent); }
.axis { display: flex; justify-content: space-between; color: var(--muted); font-size: .75rem; margin-top: 4px; }
.heat { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; }
.heat i { aspect-ratio: 1; border-radius: 2px; background: var(--ink); }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; font-size: var(--step-small); margin: 0; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; }
.meter { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; margin-top: 4px; }
.meter i { display: block; height: 100%; background: var(--ink); }
.meter i.hot { background: var(--accent); }
.limitrow { display: grid; gap: 2px; margin-bottom: 12px; font-size: var(--step-small); }
.big { font-size: var(--step-num); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
.cap { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cap input { width: 7em; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.scroll { overflow-x: auto; }
@media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, 1fr); } .two { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  function text(n, t) { n.textContent = t == null || t === '' ? '—' : String(t); return n; }
  function el(tag, cls, t) { var n = document.createElement(tag); if (cls) n.className = cls; if (t !== undefined) text(n, t); return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function when(iso) { if (!iso) return '—'; var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString(); }
  function tool(n) { return String(n || '').replace(/^teams_/, ''); }
  function facts(dl, pairs) { clear(dl); pairs.forEach(function (p) { dl.appendChild(el('dt', '', p[0])); dl.appendChild(el('dd', '', p[1])); }); }
  async function api(path, opts) { opts = opts || {}; opts.headers = Object.assign({ 'X-Admin': '1' }, opts.headers || {}); return fetch(path, opts); }

  function cols(box, values, accent) {
    clear(box); var max = Math.max.apply(null, values.map(function (v) { return v.v; }).concat([1]));
    values.forEach(function (v) { var i = el('i', accent && accent(v) ? 'w' : ''); i.style.height = (v.v / max * 100) + '%'; i.title = v.label + ': ' + v.v; box.appendChild(i); });
  }
  function heat(box, hours) {
    clear(box); var max = Math.max.apply(null, hours.concat([1]));
    hours.forEach(function (h, i) { var c = el('i'); c.style.opacity = (0.08 + 0.92 * h / max).toFixed(2); c.title = String(i).padStart(2, '0') + ':00 UTC — ' + h + ' requests'; box.appendChild(c); });
  }
  function toolTable(tbody, tools) {
    clear(tbody);
    if (!tools.length) { var tr = el('tr'); var td = el('td', 'muted', 'No tool calls yet.'); td.colSpan = 6; tr.appendChild(td); tbody.appendChild(tr); return; }
    tools.forEach(function (t) {
      var tr = el('tr'); tr.appendChild(el('td', '', tool(t.name)));
      [t.calls, t.people, t.avgMs + ' ms', t.avgKb + ' KB', t.errorRate + '%'].forEach(function (v) { tr.appendChild(el('td', 'num', v)); });
      tbody.appendChild(tr);
    });
  }

  function renderCloud(c) {
    var box = clear($('cloud'));
    if (!c || !c.configured) { box.appendChild(el('p', 'muted', (c && c.note) || 'Cloud usage is not set up.')); return; }
    if (c.error) { box.appendChild(el('p', 'muted', 'Could not read Cloudflare analytics: ' + c.error)); return; }
    var top = el('div', 'two');
    var left = el('div'); left.appendChild(el('div', 'big', '$' + c.costNow.toFixed(2)));
    left.appendChild(el('p', 'muted', 'Spent this month on ' + c.plan + '. If you moved to the paid plan, this month\\'s pace would cost about $' + c.paidEstimate.total.toFixed(2) + '/month ($5 base + usage).'));
    var dl = el('dl', 'facts'); dl.style.marginTop = '12px';
    facts(dl, [['Requests this month', num(c.month.requests)], ['Projected for 30 days', num(c.projectedMonth.requests)], ['Errors this month', num(c.month.errors)],
      ['CPU per request (median, today)', c.today.cpuP50Ms + ' ms'], ['Database rows read / written this month', num(c.month.rowsRead) + ' / ' + num(c.month.rowsWritten)]]);
    left.appendChild(dl);
    var right = el('div'); right.appendChild(el('p', 'muted', 'Free plan limits'));
    c.limits.forEach(function (l) {
      var row = el('div', 'limitrow'); row.appendChild(el('span', '', l.label + ': ' + num(l.used) + ' of ' + num(l.limit) + ' (' + l.percent + '%)'));
      var m = el('div', 'meter'); var i = el('i', l.percent >= 80 ? 'hot' : ''); i.style.width = Math.min(100, l.percent) + '%'; m.appendChild(i); row.appendChild(m); right.appendChild(row);
    });
    right.appendChild(el('p', 'muted', 'From Cloudflare analytics (a few minutes behind). Updated ' + when(c.asOf) + '.'));
    top.appendChild(left); top.appendChild(right); box.appendChild(top);
  }

  function renderPeople(people) {
    var tb = clear($('people'));
    if (!people.length) { var tr = el('tr'); var td = el('td', 'muted', 'No usage recorded yet. Usage is counted from v0.8.0 on.'); td.colSpan = 10; tr.appendChild(td); tb.appendChild(tr); return; }
    var max = Math.max.apply(null, people.map(function (p) { return p.share; }).concat([1]));
    people.forEach(function (p) {
      var tr = el('tr'); var td = el('td'); var b = el('button', 'open', p.name || 'Unknown person'); b.type = 'button';
      b.addEventListener('click', function () { openPerson(p.key); }); td.appendChild(b); tr.appendChild(td);
      tr.appendChild(el('td', '', p.apps.join(', ') || '—'));
      tr.appendChild(el('td', 'num', num(p.totals.requests)));
      var s = el('td'); var w = el('div', 'share'); var bar = el('i'); bar.style.width = Math.max(2, p.share / max * 90) + 'px'; w.appendChild(bar); w.appendChild(el('span', '', p.share + '%')); s.appendChild(w); tr.appendChild(s);
      [p.totals.toolCalls, p.totals.changes, p.totals.searches, p.totals.errors].forEach(function (v) { tr.appendChild(el('td', 'num', num(v))); });
      tr.appendChild(el('td', '', tool(p.topTool)));
      tr.appendChild(el('td', '', when(p.lastActive)));
      tb.appendChild(tr);
    });
  }

  function renderConnections(list) {
    var tb = clear($('conn'));
    if (!list.length) { var tr = el('tr'); var td = el('td', 'muted', 'No connections yet.'); td.colSpan = 6; tr.appendChild(td); tb.appendChild(tr); }
    list.forEach(function (c) {
      var tr = el('tr');
      [c.person || 'Unknown', c.app || 'Unknown (before v0.7.1)', when(c.createdAt), when(c.lastUsedAt), day(c.expiresAt)].forEach(function (v) { tr.appendChild(el('td', '', v)); });
      var td = el('td'); var b = el('button', 'end', 'End connection'); b.type = 'button';
      b.addEventListener('click', async function () {
        if (!confirm('End this connection? The app using it will need to sign in again.')) return;
        await api('/admin/api/connections/' + c.id + '/end', { method: 'POST' }); load();
      });
      td.appendChild(b); tr.appendChild(td); tb.appendChild(tr);
    });
  }

  function render(d) {
    data = d;
    var al = clear($('alerts'));
    d.alerts.forEach(function (a) { al.appendChild(el('div', 'alert' + (a.level === 'bad' ? ' bad' : ''), a.text)); });
    var k = d.totals;
    [['people', 'People'], ['activeToday', 'Active today'], ['active7', 'Active, 7 days'], ['requestsToday', 'Requests today'], ['toolCallsToday', 'Tool calls today'], ['changesToday', 'Changes today']]
      .forEach(function (p) { text($('k-' + p[0]), num(k[p[0]])); });
    renderCloud(d.cloud);
    renderPeople(d.people);
    cols($('daily'), d.daily.map(function (x) { return { v: x.requests, label: x.day }; }));
    text($('dailyFrom'), day(d.daily[0] && d.daily[0].day)); text($('dailyTo'), 'today');
    heat($('hours'), d.hours);
    toolTable($('tools'), d.tools);
    var a = d.adoption;
    facts($('adoption'), [['Active today / 7 days / 30 days', a.activeToday + ' / ' + a.active7 + ' / ' + a.active30], ['New people this week', a.newThisWeek],
      ['Connected but never used', a.neverUsed], ['Idle for 30+ days', a.idle30], ['Ending within 14 days (unused)', a.expiring14],
      ['Apps', Object.keys(a.appMix).map(function (x) { return x + ' ' + a.appMix[x]; }).join(', ') || '—'], ['Registered apps', k.registeredApps], ['Connections', k.connections]]);
    renderConnections(d.connections);
    var names = { signin: 'Sign-ins', signout: 'Sign-outs', expired: 'Expired (90 days unused)', signin_not_allowed: 'Refused: not on allow-list', signin_bad_access_code: 'Refused: wrong access code',
      rate_limited_ip: 'Rate-limited (per IP)', rate_limited_user: 'Rate-limited (per person)', rate_limited_heavy: 'Search limit hit', rate_limited_write: 'Change limit hit', daily_write_cap: 'Daily change cap hit',
      admin_signin_failed: 'Failed admin sign-ins', admin_ended_connection: 'Connections ended by admin', error: 'Server errors', cleanup_run: 'Nightly cleanups' };
    facts($('events'), Object.keys(names).filter(function (m) { return d.events[m] !== undefined; }).map(function (m) { return [names[m], num(d.events[m])]; }));
    var s = d.settings, l = d.limits;
    facts($('settings'), [['Version', 'v' + d.version], ['Access code required', s.accessCodeRequired ? 'Yes' : 'No'], ['Allow-list', s.allowListSize ? s.allowListSize + ' accounts' : 'Off'],
      ['Personal URLs', s.personalUrls ? 'On' : 'Off (connectors only)'], ['New-connection notes', s.alerts ? 'On' : 'Off'],
      ['Limits per person', l.requestsPerMinute + ' requests/min, ' + l.searchesPerMinute + ' searches/min, ' + l.changesPerMinute + ' changes/min, ' + l.changesPerDay + ' changes/day'],
      ['Connections end after', l.inactiveDays + ' days unused'], ['Last nightly cleanup', d.lastCleanup || 'Not yet']]);
    var m = d.microsoft;
    facts($('microsoft'), [['Shown to people as', m.shownAs], ['Microsoft app id', m.clientId], ['Where people manage it', m.permissionsPage.replace('https://', '')]]);
    text($('msnote'), m.note); text($('privacy'), d.privacy);
  }

  async function openPerson(key) {
    var r = await api('/admin/api/person/' + encodeURIComponent(key)); if (r.status === 401) return load();
    var d = await r.json(); if (!r.ok) { alert(d.error || 'Could not load this person.'); return; }
    var p = d.person;
    $('dash').hidden = true; $('personView').hidden = false; window.scrollTo(0, 0);
    text($('pName'), p.name || 'Unknown person');
    facts($('pFacts'), [['First connected', day(p.firstConnected)], ['Last active', when(p.lastActive)], ['Active days (30)', p.activeDays], ['Apps', p.apps.join(', ')],
      ['Connections', p.connections], ['Share of all requests', p.share + '%'], ['Data returned to Claude (30 days)', num(p.totals.kb) + ' KB'], ['Calls to Microsoft (30 days)', num(p.totals.teamsCalls)]]);
    [['pReq', p.totals.requests], ['pTools', p.totals.toolCalls], ['pChanges', p.totals.changes], ['pSearch', p.totals.searches]].forEach(function (x) { text($(x[0]), num(x[1])); });
    cols($('pDaily'), d.daily.map(function (x) { return { v: x.toolCalls, label: x.day, w: x.changes }; }), function (v) { return v.w > 0; });
    heat($('pHours'), d.hours);
    toolTable($('pToolTable'), d.tools);
    var avg = p.totals.toolCalls ? Math.round(p.totals.ms / p.totals.toolCalls) : 0;
    facts($('pHealth'), [['Errors (30 days)', num(p.totals.errors)], ['Refused by limits', num(p.totals.rateLimited)], ['Slowed down by Microsoft', num(p.totals.throttled)], ['Average tool time', avg + ' ms']]);
    text($('pCapToday'), p.today.changes + ' of ' + p.dailyCap + ' changes used today (' + p.capUsedToday + '%)');
    var mi = $('pCapMeter'); mi.style.width = Math.min(100, p.capUsedToday) + '%'; mi.className = p.capUsedToday >= 80 ? 'hot' : '';
    $('pCap').value = d.capOverride == null ? '' : d.capOverride; $('pCap').placeholder = String(d.defaultCap);
    $('pCapSave').onclick = async function () {
      var v = $('pCap').value.trim(); var body = { dailyWrites: v === '' ? null : Number(v) };
      var rr = await api('/admin/api/person/' + encodeURIComponent(key) + '/limit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var jj = await rr.json(); text($('pCapMsg'), rr.ok ? (jj.dailyWrites == null ? 'Back to the default limit.' : 'Saved: ' + jj.dailyWrites + ' changes a day.') : jj.error);
    };
    $('pCsv').href = '/admin/api/person/' + encodeURIComponent(key) + '/csv';
    $('pEnd').onclick = async function () {
      if (!confirm('End all connections for ' + (p.name || 'this person') + '? Their apps will need to sign in again.')) return;
      var rr = await api('/admin/api/person/' + encodeURIComponent(key) + '/end', { method: 'POST' }); var jj = await rr.json();
      text($('pCapMsg'), 'Ended ' + (jj.ended || 0) + ' connection(s).');
    };
  }
  $('back').addEventListener('click', function () { $('personView').hidden = true; $('dash').hidden = false; load(); });

  async function load() {
    var r = await api('/admin/api/overview');
    if (r.status === 401) { $('signinForm').hidden = document.body.getAttribute('data-configured') !== '1'; $('dash').hidden = true; $('personView').hidden = true; $('out').hidden = true; return; }
    var d = await r.json();
    $('signinForm').hidden = true; $('out').hidden = false;
    if ($('personView').hidden) $('dash').hidden = false;
    render(d);
  }
  $('signinForm').addEventListener('submit', async function (e) {
    e.preventDefault(); $('err').textContent = '';
    var r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { $('err').textContent = j.error || 'Sign-in failed.'; return; }
    $('p').value = ''; load();
  });
  $('out').addEventListener('click', async function () { await api('/admin/logout', { method: 'POST' }); load(); });
  $('refresh').addEventListener('click', load);
  load();
})();`;

export function renderAdminPage({ configured }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin · Teams Personal MCP</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body data-configured="${configured ? '1' : '0'}">
<nav class="nav" aria-label="Main"><a class="word" href="/">Teams Personal MCP</a>
  <span class="right"><a href="/changelog">Changelog</a><button class="link" type="button" id="refresh">Refresh</button><button class="link" type="button" id="out" hidden>Sign out</button></span></nav>

<form class="signin" id="signinForm" hidden>
  <h1>Admin</h1>
  <label>Username<input id="u" autocomplete="username" required></label>
  <label>Password<input id="p" type="password" autocomplete="current-password" required></label>
  <button class="btn" type="submit">Sign in</button>
  <p class="err" id="err" role="alert"></p>
</form>
${configured ? '' : `<main><h1>Admin</h1><p>Admin sign-in is not set up yet. Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> (at least ${MIN_PASSWORD} characters) in Cloudflare, then reload.</p></main>`}

<main id="dash" hidden>
  <h1>Usage</h1>
  <div class="alerts" id="alerts" aria-live="polite"></div>
  <div class="kpis">
    <div class="kpi"><b id="k-people"></b><span>People</span></div>
    <div class="kpi"><b id="k-activeToday"></b><span>Active today</span></div>
    <div class="kpi"><b id="k-active7"></b><span>Active, 7 days</span></div>
    <div class="kpi"><b id="k-requestsToday"></b><span>Requests today</span></div>
    <div class="kpi"><b id="k-toolCallsToday"></b><span>Tool calls today</span></div>
    <div class="kpi"><b id="k-changesToday"></b><span>Changes today</span></div>
  </div>
  <section aria-labelledby="t-cloud"><h2 id="t-cloud">Cloud cost and limits</h2><div id="cloud"></div></section>
  <section aria-labelledby="t-people"><h2 id="t-people">People, last 30 days</h2>
    <div class="scroll"><table><thead><tr><th>Person</th><th>Apps</th><th class="num">Requests</th><th>Share</th><th class="num">Tool calls</th><th class="num">Changes</th><th class="num">Searches</th><th class="num">Errors</th><th>Top tool</th><th>Last active</th></tr></thead><tbody id="people"></tbody></table></div>
    <p class="muted" style="margin-top:8px" id="privacy"></p>
  </section>
  <div class="two">
    <section aria-labelledby="t-daily"><h2 id="t-daily">Requests per day</h2><div class="cols" id="daily"></div><div class="axis"><span id="dailyFrom"></span><span id="dailyTo"></span></div></section>
    <section aria-labelledby="t-hours"><h2 id="t-hours">Busiest hours (UTC)</h2><div class="heat" id="hours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>
  </div>
  <section aria-labelledby="t-tools"><h2 id="t-tools">Tools, last 30 days</h2>
    <div class="scroll"><table><thead><tr><th>Tool</th><th class="num">Calls</th><th class="num">People</th><th class="num">Avg time</th><th class="num">Avg size</th><th class="num">Errors</th></tr></thead><tbody id="tools"></tbody></table></div>
    <p class="muted" style="margin-top:8px">Avg size is the data each call returns to the assistant: larger results use more of people's Claude context.</p>
  </section>
  <div class="two">
    <section aria-labelledby="t-adopt"><h2 id="t-adopt">Adoption and upkeep</h2><dl class="facts" id="adoption"></dl></section>
    <section aria-labelledby="t-events"><h2 id="t-events">Events, last 14 days</h2><dl class="facts" id="events"></dl></section>
  </div>
  <section aria-labelledby="t-conn"><h2 id="t-conn">Connections</h2>
    <div class="scroll"><table><thead><tr><th>Person</th><th>App</th><th>Created</th><th>Last used</th><th>Ends if unused by</th><th></th></tr></thead><tbody id="conn"></tbody></table></div>
  </section>
  <div class="two">
    <section aria-labelledby="t-set"><h2 id="t-set">Settings and limits</h2><dl class="facts" id="settings"></dl></section>
    <section aria-labelledby="t-ms"><h2 id="t-ms">On Microsoft's side</h2><dl class="facts" id="microsoft"></dl><p class="muted" id="msnote" style="margin-top:10px"></p></section>
  </div>
</main>

<main id="personView" hidden>
  <p><button class="link" type="button" id="back">← All people</button></p>
  <h1 id="pName"></h1>
  <div class="kpis">
    <div class="kpi"><b id="pReq"></b><span>Requests, 30 days</span></div>
    <div class="kpi"><b id="pTools"></b><span>Tool calls</span></div>
    <div class="kpi"><b id="pChanges"></b><span>Changes</span></div>
    <div class="kpi"><b id="pSearch"></b><span>Searches</span></div>
  </div>
  <div class="two">
    <section aria-labelledby="t-pabout"><h2 id="t-pabout">About</h2><dl class="facts" id="pFacts"></dl></section>
    <section aria-labelledby="t-plimit"><h2 id="t-plimit">Daily change limit</h2>
      <p class="muted" id="pCapToday"></p><div class="meter" style="margin:8px 0 14px"><i id="pCapMeter"></i></div>
      <div class="cap"><label class="muted" for="pCap">Changes a day for this person</label><input id="pCap" inputmode="numeric"><button class="btn quiet" type="button" id="pCapSave">Save</button></div>
      <p class="muted" id="pCapMsg" style="margin-top:8px">Leave empty to use the default.</p>
      <div class="actions" style="margin-top:18px"><a class="btn quiet" id="pCsv" href="#" download>Export CSV</a><button class="btn" type="button" id="pEnd">End all connections</button></div>
    </section>
  </div>
  <div class="two">
    <section aria-labelledby="t-pdaily"><h2 id="t-pdaily">Tool calls per day</h2><div class="cols" id="pDaily"></div><p class="muted" style="margin-top:6px">Red days include changes to Teams.</p></section>
    <section aria-labelledby="t-phours"><h2 id="t-phours">When they use it (UTC)</h2><div class="heat" id="pHours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>
  </div>
  <section aria-labelledby="t-ptools"><h2 id="t-ptools">Their tools</h2>
    <div class="scroll"><table><thead><tr><th>Tool</th><th class="num">Calls</th><th class="num">People</th><th class="num">Avg time</th><th class="num">Avg size</th><th class="num">Errors</th></tr></thead><tbody id="pToolTable"></tbody></table></div>
  </section>
  <section aria-labelledby="t-phealth"><h2 id="t-phealth">Health</h2><dl class="facts" id="pHealth"></dl></section>
</main>
<script>${SCRIPT}</script>
</body></html>`;
}
