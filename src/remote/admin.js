// Admin area: /admin (sign-in + dashboard), /admin/api/* (JSON for the dashboard), /admin/stats (token API).
//
// Sign-in: ADMIN_USERNAME + ADMIN_PASSWORD (Cloudflare secrets the admin sets themselves).
// Session: an HttpOnly, Secure, SameSite=Strict cookie "<expiry>.<HMAC>", valid 8 hours. The HMAC key
// includes the password, so changing the password ends every session.
// Scripts (curl, monitoring) can still use ADMIN_TOKEN as a Bearer token on /admin/stats and /admin/api/*.
import { hmacHex, safeEqual } from './crypto.js';

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

export async function overview(env, { version, settings, inactiveDays }) {
  const now = Date.now();
  const count = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).first())?.n ?? 0;
  const since30 = new Date(now - 30 * DAY_MS).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare('SELECT day, metric, count FROM stats WHERE day >= ? ORDER BY day').bind(since30).all()).results || [];
  const activity = {};
  const tools = {};
  for (const r of rows) {
    if (r.metric.startsWith('tool:')) {
      const name = r.metric.slice(5);
      tools[name] = (tools[name] || 0) + r.count;
    } else {
      (activity[r.day] ||= {})[r.metric] = r.count;
    }
  }
  const connections = ((await env.DB.prepare(
    `SELECT u.id, u.account_name, u.app_name, u.account_hash, u.created_at, COALESCE(u.last_used_at, u.created_at) AS last_used,
            COALESCE(g.writes, 0) AS writes_today
       FROM users u LEFT JOIN usage g ON g.user_id = u.id AND g.day = ?
      ORDER BY last_used DESC`,
  ).bind(today).all()).results || []).map((c) => ({
    id: c.id,
    person: c.account_name || null,
    account: c.account_hash ? c.account_hash.slice(0, 8) : null,
    app: c.app_name || null,
    createdAt: new Date(c.created_at).toISOString(),
    lastUsedAt: new Date(c.last_used).toISOString(),
    expiresAt: new Date(c.last_used + inactiveDays * DAY_MS).toISOString(),
    writesToday: c.writes_today,
  }));
  const lastCleanup = await env.DB.prepare("SELECT day FROM stats WHERE metric = 'cleanup_run' ORDER BY day DESC LIMIT 1").first();
  return {
    version,
    totals: {
      connections: connections.length,
      people: new Set(connections.map((c) => c.account).filter(Boolean)).size,
      activeLast7Days: connections.filter((c) => now - Date.parse(c.lastUsedAt) < 7 * DAY_MS).length,
      activeLast30Days: connections.filter((c) => now - Date.parse(c.lastUsedAt) < 30 * DAY_MS).length,
      registeredApps: await count('SELECT COUNT(*) AS n FROM oauth_clients'),
      changesToday: connections.reduce((s, c) => s + c.writesToday, 0),
    },
    connections,
    activity,
    tools: Object.entries(tools).sort((a, b) => b[1] - a[1]).map(([name, calls]) => ({ name, calls })),
    settings,
    limits: { requestsPerMinute: 120, searchesPerMinute: 10, changesPerMinute: 10, changesPerDay: 200, inactiveDays },
    lastCleanup: lastCleanup?.day || null,
    microsoft: {
      shownAs: "Microsoft Teams (Microsoft's own app, not a separate plugin)",
      clientId: TEAMS_CLIENT_ID,
      permissionsPage: 'https://account.live.com/consent/Manage',
      note: 'This server signs people in through the same Microsoft Teams app that teams.live.com uses, so Microsoft treats it as Teams, ' +
        'not as a third-party plugin. To cut off only this server, use End connection here (or teams_logout). ' +
        'Removing Teams in Microsoft account settings can also sign the person out of their normal Teams.',
    },
  };
}

export async function endConnection(env, id) {
  if (!/^[0-9a-f]{64}$/.test(id || '')) return json({ error: 'Unknown connection.' }, 400);
  const r = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return json({ ended: (r.meta?.changes ?? 0) > 0 });
}

// ---------------------------------------------------------------- page

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
:root { --bg:#ffffff; --surface:#f2f2f2; --surface-2:#e6e6e6; --ink:#0a0a0a; --muted:#5c5c5c; --accent:#d92b21; --accent-press:#b8231b; --accent-ink:#ffffff;
  --step-small: 0.875rem; --step-body: 1rem; --step-head: clamp(1.75rem, 1.2rem + 2vw, 2.75rem); --step-num: clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem);
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
.link { font: inherit; background: none; border: 0; padding: 0; cursor: pointer; color: var(--muted); text-decoration: underline; text-underline-offset: .2em; }
.link:hover { color: var(--ink); }
main { padding: 8px var(--margin) 64px; display: grid; gap: 48px; }
h1 { margin: 0; font-size: var(--step-head); font-weight: 600; letter-spacing: -0.04em; line-height: 1; }
h2 { margin: 0 0 14px; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; }
.muted { color: var(--muted); font-size: var(--step-small); }
/* sign-in */
.signin { max-width: 380px; margin: 12vh auto 0; display: grid; gap: 14px; }
.signin label { font-size: var(--step-small); color: var(--muted); display: grid; gap: 6px; }
.signin input { font: 500 var(--step-body)/1.2 var(--font); padding: .75em .9em; border: 0; border-radius: var(--radius); background: var(--surface); color: var(--ink); }
.err { color: var(--accent); font-size: var(--step-small); min-height: 1.4em; margin: 0; }
/* dashboard */
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; background: var(--bg); }
.kpi { background: var(--surface); padding: 16px; }
.kpi b { display: block; font-size: var(--step-num); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--muted); font-size: var(--step-small); }
table { width: 100%; border-collapse: collapse; font-size: var(--step-small); }
th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px 10px; background: var(--surface); }
td { padding: 9px 10px; border-bottom: 1px solid var(--surface-2); vertical-align: top; font-variant-numeric: tabular-nums; }
td .end { font: 500 var(--step-small)/1 var(--font); background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: .2em; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
.bars { display: grid; gap: 6px; }
.bar { display: grid; grid-template-columns: 10ch 1fr 5ch; gap: 10px; align-items: center; font-size: var(--step-small); }
.bar i { display: block; height: 10px; background: var(--ink); border-radius: 2px; min-width: 2px; }
.bar i.sub { background: var(--accent); }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; font-size: var(--step-small); margin: 0; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; }
.scroll { overflow-x: auto; }
@media (max-width: 860px) { .kpis { grid-template-columns: repeat(2, 1fr); } .two { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function text(n, t) { n.textContent = t == null ? '—' : String(t); return n; }
  function el(tag, cls, t) { var n = document.createElement(tag); if (cls) n.className = cls; if (t !== undefined) text(n, t); return n; }
  function when(iso) { if (!iso) return '—'; var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

  async function load() {
    var r = await fetch('/admin/api/overview', { headers: { 'X-Admin': '1' } });
    if (r.status === 401) { $('signinForm').hidden = document.body.getAttribute('data-configured') !== '1'; $('dash').hidden = true; $('out').hidden = true; return; }
    var d = await r.json();
    $('signinForm').hidden = true; $('dash').hidden = false; $('out').hidden = false;
    var k = d.totals;
    [['connections', 'Connections'], ['people', 'People'], ['activeLast7Days', 'Active, 7 days'], ['activeLast30Days', 'Active, 30 days'], ['registeredApps', 'Registered apps'], ['changesToday', 'Changes today']]
      .forEach(function (p) { var b = $('k-' + p[0]); text(b, k[p[0]]); });

    var tb = $('conn'); tb.innerHTML = '';
    if (!d.connections.length) { var tr = el('tr'); var td = el('td', '', 'No connections yet.'); td.colSpan = 7; tr.appendChild(td); tb.appendChild(tr); }
    d.connections.forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', '', c.person || (c.account ? 'Account ' + c.account : 'Unknown')));
      tr.appendChild(el('td', '', c.app || 'Unknown (before v0.8)'));
      tr.appendChild(el('td', '', when(c.createdAt)));
      tr.appendChild(el('td', '', when(c.lastUsedAt)));
      tr.appendChild(el('td', '', day(c.expiresAt)));
      tr.appendChild(el('td', '', c.writesToday));
      var td = el('td'); var b = el('button', 'end', 'End connection'); b.type = 'button';
      b.addEventListener('click', async function () {
        if (!confirm('End this connection? The app using it will need to sign in again.')) return;
        await fetch('/admin/api/connections/' + c.id + '/end', { method: 'POST', headers: { 'X-Admin': '1' } });
        load();
      });
      td.appendChild(b); tr.appendChild(td); tb.appendChild(tr);
    });

    var days = Object.keys(d.activity).sort().slice(-14);
    var max = Math.max(1, ...days.map(function (x) { return d.activity[x].signin || 0; }));
    var act = $('activity'); act.innerHTML = '';
    if (!days.length) act.appendChild(el('p', 'muted', 'No activity recorded yet.'));
    days.forEach(function (x) {
      var a = d.activity[x], row = el('div', 'bar');
      row.appendChild(el('span', '', new Date(x + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
      var i = el('i'); i.style.width = ((a.signin || 0) / max * 100) + '%'; i.title = (a.signin || 0) + ' sign-ins';
      row.appendChild(i); row.appendChild(el('span', '', a.signin || 0)); act.appendChild(row);
    });
    var totals = {}; days.forEach(function (x) { Object.keys(d.activity[x]).forEach(function (m) { totals[m] = (totals[m] || 0) + d.activity[x][m]; }); });
    var names = { signin: 'Sign-ins', signout: 'Sign-outs', expired: 'Expired (90 days unused)', signin_not_allowed: 'Refused: not on allow-list', signin_bad_access_code: 'Refused: wrong access code',
      rate_limited_ip: 'Rate-limited (per IP)', rate_limited_user: 'Rate-limited (per person)', rate_limited_heavy: 'Search limit hit', rate_limited_write: 'Change limit hit', daily_write_cap: 'Daily change cap hit',
      admin_signin_failed: 'Failed admin sign-ins', error: 'Server errors', mcp_request: 'MCP requests', cleanup_run: 'Nightly cleanups' };
    var tt = $('totals'); tt.innerHTML = '';
    Object.keys(names).forEach(function (m) { if (totals[m] === undefined) return; tt.appendChild(el('dt', '', names[m])); tt.appendChild(el('dd', '', totals[m])); });
    if (!tt.children.length) tt.appendChild(el('dd', 'muted', 'Nothing yet.'));

    var tl = $('tools'); tl.innerHTML = '';
    var tmax = Math.max(1, ...d.tools.map(function (t) { return t.calls; }));
    if (!d.tools.length) tl.appendChild(el('p', 'muted', 'No tool calls recorded yet.'));
    d.tools.slice(0, 15).forEach(function (t) {
      var row = el('div', 'bar'); row.style.gridTemplateColumns = '26ch 1fr 6ch';
      row.appendChild(el('span', '', t.name.replace(/^teams_/, '')));
      var i = el('i', /send|reply|edit|delete|reaction|group|leave|mark/.test(t.name) ? 'sub' : ''); i.style.width = (t.calls / tmax * 100) + '%';
      row.appendChild(i); row.appendChild(el('span', '', t.calls)); tl.appendChild(row);
    });

    var s = d.settings, l = d.limits, f = $('settings'); f.innerHTML = '';
    [['Version', 'v' + d.version], ['Access code required', s.accessCodeRequired ? 'Yes' : 'No'], ['Allow-list', s.allowListSize ? s.allowListSize + ' accounts' : 'Off'],
     ['Personal URLs', s.personalUrls ? 'On' : 'Off (connectors only)'], ['New-connection notes', s.alerts ? 'On' : 'Off'],
     ['Limits per person', l.requestsPerMinute + ' requests/min, ' + l.searchesPerMinute + ' searches/min, ' + l.changesPerMinute + ' changes/min, ' + l.changesPerDay + ' changes/day'],
     ['Connections end after', l.inactiveDays + ' days unused'], ['Last nightly cleanup', d.lastCleanup || 'Not yet']]
      .forEach(function (p) { f.appendChild(el('dt', '', p[0])); f.appendChild(el('dd', '', p[1])); });

    var m = d.microsoft, mf = $('microsoft'); mf.innerHTML = '';
    mf.appendChild(el('dt', '', 'Shown to people as')); mf.appendChild(el('dd', '', m.shownAs));
    mf.appendChild(el('dt', '', 'Microsoft app id')); var code = el('dd'); code.appendChild(el('code', '', m.clientId)); mf.appendChild(code);
    mf.appendChild(el('dt', '', 'Where people manage it')); var dd = el('dd'); var a = el('a', '', m.permissionsPage.replace('https://', '')); a.href = m.permissionsPage; a.target = '_blank'; a.rel = 'noopener'; dd.appendChild(a); mf.appendChild(dd);
    $('msnote').textContent = m.note;
  }

  $('signinForm').addEventListener('submit', async function (e) {
    e.preventDefault(); $('err').textContent = '';
    var r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { $('err').textContent = j.error || 'Sign-in failed.'; return; }
    $('p').value = ''; load();
  });
  $('out').addEventListener('click', async function () { await fetch('/admin/logout', { method: 'POST', headers: { 'X-Admin': '1' } }); load(); });
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
${configured ? '' : `<main><h1>Admin</h1><p>Admin sign-in is not set up yet. Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> (at least ${MIN_PASSWORD} characters) as Cloudflare secrets, then reload.</p></main>`}

<main id="dash" hidden>
  <h1>Usage</h1>
  <section aria-labelledby="t-kpi"><h2 id="t-kpi" class="sr" hidden>Totals</h2>
    <div class="kpis">
      <div class="kpi"><b id="k-connections"></b><span>Connections</span></div>
      <div class="kpi"><b id="k-people"></b><span>People</span></div>
      <div class="kpi"><b id="k-activeLast7Days"></b><span>Active, 7 days</span></div>
      <div class="kpi"><b id="k-activeLast30Days"></b><span>Active, 30 days</span></div>
      <div class="kpi"><b id="k-registeredApps"></b><span>Registered apps</span></div>
      <div class="kpi"><b id="k-changesToday"></b><span>Changes today</span></div>
    </div>
  </section>
  <section aria-labelledby="t-conn"><h2 id="t-conn">Connections</h2>
    <div class="scroll"><table><thead><tr><th>Person</th><th>App</th><th>Created</th><th>Last used</th><th>Ends if unused by</th><th>Changes today</th><th></th></tr></thead><tbody id="conn"></tbody></table></div>
  </section>
  <div class="two">
    <section aria-labelledby="t-act"><h2 id="t-act">Sign-ins, last 14 days</h2><div class="bars" id="activity"></div></section>
    <section aria-labelledby="t-tot"><h2 id="t-tot">Events, last 14 days</h2><dl class="facts" id="totals"></dl></section>
  </div>
  <div class="two">
    <section aria-labelledby="t-tools"><h2 id="t-tools">Tool use, last 30 days</h2><p class="muted" style="margin:0 0 10px">Red bars change Teams (send, react, edit, groups).</p><div class="bars" id="tools"></div></section>
    <section aria-labelledby="t-set"><h2 id="t-set">Settings and limits</h2><dl class="facts" id="settings"></dl>
      <h2 style="margin-top:28px" id="t-ms">On Microsoft's side</h2><dl class="facts" id="microsoft"></dl><p class="muted" id="msnote" style="margin-top:10px"></p></section>
  </div>
</main>
<script>${SCRIPT}</script>
</body></html>`;
}
