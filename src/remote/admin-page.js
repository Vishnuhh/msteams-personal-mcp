// Admin app: sign-in plus a sidebar layout with one view per area.
// Views: #overview (the dashboard), #people, #person/<key>, #tools, #cloud, #connections, #activity, #settings.
// Data comes from /admin/api/overview (loaded once, refreshed on demand) and /admin/api/person/<key>.
// Everything that came from Teams (names, app names) is inserted with textContent, never as HTML.

const MIN_PASSWORD = 12;

const CSS = `
:root { --bg:#ffffff; --side:#f6f6f6; --surface:#f2f2f2; --surface-2:#e6e6e6; --ink:#0a0a0a; --muted:#5c5c5c; --accent:#d92b21; --accent-press:#b8231b; --accent-ink:#ffffff;
  --step-small: 0.875rem; --step-body: 1rem; --step-head: clamp(1.6rem, 1.2rem + 1.4vw, 2.25rem); --step-num: clamp(1.5rem, 1.1rem + 1.2vw, 2.1rem);
  --pad: clamp(16px, 2.4vw, 36px); --radius: 4px; --side-w: 232px;
  --font: "Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 var(--step-body)/1.5 var(--font); }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; }
[hidden] { display: none !important; }
.btn { font: 500 var(--step-body)/1 var(--font); background: var(--accent); color: var(--accent-ink); border: 0; border-radius: var(--radius); padding: .8em 1.1em; cursor: pointer; text-decoration: none; display: inline-block; transition: background-color .15s, transform .15s; }
.btn:hover { background: var(--accent-press); }
.btn:active { transform: scale(.97); }
.btn.quiet { background: var(--surface); color: var(--ink); }
.btn.quiet:hover { background: var(--surface-2); }
.link { font: inherit; background: none; border: 0; padding: 0; cursor: pointer; color: var(--muted); text-decoration: underline; text-underline-offset: .2em; }
.link:hover { color: var(--ink); }
.muted { color: var(--muted); font-size: var(--step-small); margin: 0; }

/* sign-in */
.signin { max-width: 380px; margin: 14vh auto 0; padding: 0 var(--pad); display: grid; gap: 14px; }
.signin h1 { margin: 0; font-size: var(--step-head); letter-spacing: -0.04em; }
.signin label { font-size: var(--step-small); color: var(--muted); display: grid; gap: 6px; }
.signin input, .cap input { font: 500 var(--step-body)/1.2 var(--font); padding: .7em .9em; border: 0; border-radius: var(--radius); background: var(--surface); color: var(--ink); }
.err { color: var(--accent); font-size: var(--step-small); min-height: 1.4em; margin: 0; }
.notset { max-width: 560px; margin: 14vh auto 0; padding: 0 var(--pad); }

/* app shell */
.app { display: grid; grid-template-columns: var(--side-w) 1fr; min-height: 100vh; }
.side { background: var(--side); position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 20px 14px; gap: 18px; }
.side .word { font-weight: 600; letter-spacing: -0.03em; text-decoration: none; padding: 0 10px; }
.side .sub { color: var(--muted); font-size: var(--step-small); padding: 0 10px; margin-top: -14px; }
.menu { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.menu a { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 10px; border-radius: var(--radius); text-decoration: none; font-size: .95rem; color: var(--muted); transition: background-color .12s, color .12s; }
.menu a:hover { background: var(--surface-2); color: var(--ink); }
.menu a[aria-current="page"] { background: var(--ink); color: #fff; }
.menu .count { font-size: .78rem; font-variant-numeric: tabular-nums; opacity: .8; }
.menu .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.side .foot { margin-top: auto; display: grid; gap: 8px; padding: 0 10px; font-size: var(--step-small); }
.side .foot .link { text-align: left; }
.content { padding: 28px var(--pad) 64px; min-width: 0; }
.view { display: grid; gap: 36px; max-width: 1180px; }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.head h1 { margin: 0; font-size: var(--step-head); font-weight: 600; letter-spacing: -0.04em; line-height: 1; }
h2 { margin: 0 0 12px; font-size: 1.1rem; font-weight: 600; letter-spacing: -0.02em; }
.card { background: var(--bg); }
.tile { background: var(--surface); border-radius: var(--radius); padding: 16px; }

/* data */
.alerts { display: grid; gap: 6px; }
.alerts:empty { display: none; }
.alert { padding: 10px 14px; border-radius: var(--radius); background: #fff4d6; color: #5c3d00; font-size: var(--step-small); }
.alert.bad { background: #fde3e1; color: #7a1712; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 2px; }
.kpi { background: var(--surface); padding: 14px 16px; }
.kpi b { display: block; font-size: var(--step-num); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--muted); font-size: var(--step-small); }
table { width: 100%; border-collapse: collapse; font-size: var(--step-small); }
th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px 10px; background: var(--surface); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid var(--surface-2); vertical-align: middle; font-variant-numeric: tabular-nums; }
td.num, th.num { text-align: right; }
td a.open { font-weight: 600; text-underline-offset: .2em; white-space: nowrap; }
td .end { font: 500 var(--step-small)/1 var(--font); background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: .2em; }
.share { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.share i { display: block; height: 8px; background: var(--ink); border-radius: 2px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; }
.three { display: grid; grid-template-columns: 2fr 1fr; gap: 36px; }
.cols { display: flex; align-items: flex-end; gap: 3px; height: 130px; border-bottom: 1px solid var(--surface-2); }
.cols i { flex: 1; background: var(--ink); min-height: 1px; border-radius: 2px 2px 0 0; }
.cols i.w { background: var(--accent); }
.axis { display: flex; justify-content: space-between; color: var(--muted); font-size: .75rem; margin-top: 4px; }
.heat { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; }
.heat i { aspect-ratio: 1; border-radius: 2px; background: var(--ink); }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; font-size: var(--step-small); margin: 0; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.meter { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; margin-top: 4px; }
.meter i { display: block; height: 100%; background: var(--ink); }
.meter i.hot { background: var(--accent); }
.limitrow { display: grid; gap: 2px; margin-bottom: 12px; font-size: var(--step-small); }
.big { font-size: var(--step-num); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
.rank { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: var(--step-small); }
.rank li { display: grid; grid-template-columns: 1fr 90px 52px; gap: 10px; align-items: center; }
.rank li i { display: block; height: 8px; background: var(--ink); border-radius: 2px; }
.rank li .n { text-align: right; font-variant-numeric: tabular-nums; }
.cap { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
td .go { font: 600 var(--step-small)/1 var(--font); background: none; border: 0; color: var(--ink); cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: .2em; }
td .acts { display: flex; gap: 14px; justify-content: flex-end; white-space: nowrap; }
.menu .count.hot { background: var(--accent); color: #fff; opacity: 1; border-radius: 9px; padding: 1px 7px; }
.seg { display: inline-flex; background: var(--surface); border-radius: var(--radius); padding: 3px; gap: 3px; }
.seg button { font: 500 var(--step-small)/1 var(--font); border: 0; background: none; color: var(--muted); padding: 8px 14px; border-radius: 3px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--ink); color: #fff; }
.inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.inline input { font: 500 var(--step-small)/1.2 var(--font); padding: .7em .9em; border: 0; border-radius: var(--radius); background: var(--surface); color: var(--ink); min-width: 0; }
.inline input[type="number"] { width: 5.5em; }
.inline label { display: flex; align-items: center; gap: 6px; }
.inline .grow { flex: 1 1 260px; }
.newlink { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--surface); border-radius: var(--radius); padding: 12px 14px; margin-top: 12px; }
.newlink code { overflow-wrap: anywhere; flex: 1 1 280px; }
.sub2 { margin: -6px 0 10px; }
.cap input { width: 7em; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.scroll { overflow-x: auto; }
.empty { color: var(--muted); font-size: var(--step-small); padding: 12px 0; }

@media (max-width: 900px) {
  .app { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .side { position: sticky; top: 0; height: auto; z-index: 5; flex-direction: row; align-items: center; gap: 10px; padding: 10px 12px; overflow-x: auto; }
  .side .word, .side .sub, .side .foot .ver { display: none; }
  .menu { display: flex; gap: 4px; }
  .menu a { white-space: nowrap; padding: 7px 10px; }
  .menu .count { display: none; }
  .side .foot { margin: 0; display: flex; gap: 12px; padding: 0; white-space: nowrap; }
  .two, .three { grid-template-columns: 1fr; }
}
`;

const SCRIPT = `
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var data = null, loading = null;
  function text(n, t) { n.textContent = t == null || t === '' ? '—' : String(t); return n; }
  function el(tag, cls, t) { var n = document.createElement(tag); if (cls) n.className = cls; if (t !== undefined) text(n, t); return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function when(iso) { if (!iso) return '—'; var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString(); }
  function tool(n) { return String(n || '').replace(/^teams_/, ''); }
  function facts(dl, pairs) { clear(dl); pairs.forEach(function (p) { dl.appendChild(el('dt', '', p[0])); dl.appendChild(el('dd', '', p[1])); }); }
  function empty(tbody, cols, msg) { var tr = el('tr'); var td = el('td', 'empty', msg); td.colSpan = cols; tr.appendChild(td); tbody.appendChild(tr); }
  function personLink(p) { var a = el('a', 'open', p.name || 'Unknown person'); a.href = '#person/' + encodeURIComponent(p.key); return a; }
  async function api(path, opts) { opts = opts || {}; opts.headers = Object.assign({ 'X-Admin': '1' }, opts.headers || {}); return fetch(path, opts); }

  function cols(box, values, accent) {
    clear(box); var max = Math.max.apply(null, values.map(function (v) { return v.v; }).concat([1]));
    values.forEach(function (v) { var i = el('i', accent && accent(v) ? 'w' : ''); i.style.height = (v.v / max * 100) + '%'; i.title = v.label + ': ' + v.v; box.appendChild(i); });
  }
  function heat(box, hours) {
    clear(box); var max = Math.max.apply(null, hours.concat([1]));
    hours.forEach(function (h, i) { var c = el('i'); c.style.opacity = (0.08 + 0.92 * h / max).toFixed(2); c.title = String(i).padStart(2, '0') + ':00 UTC — ' + h + ' requests'; box.appendChild(c); });
  }
  function rank(list, items) {
    clear(list); if (!items.length) { list.appendChild(el('li', 'empty', 'Nothing yet.')); return; }
    var max = Math.max.apply(null, items.map(function (x) { return x.v; }).concat([1]));
    items.forEach(function (x) { var li = el('li'); li.appendChild(x.label); var bar = el('i'); bar.style.width = Math.max(3, x.v / max * 100) + '%'; li.appendChild(bar); li.appendChild(el('span', 'n', x.text)); list.appendChild(li); });
  }
  function toolTable(tbody, tools, withPeople) {
    clear(tbody); if (!tools.length) return empty(tbody, 6, 'No tool calls yet.');
    tools.forEach(function (t) {
      var tr = el('tr'); tr.appendChild(el('td', '', tool(t.name)));
      var cells = [t.calls].concat(withPeople ? [t.people] : []).concat([t.avgMs + ' ms', t.avgKb + ' KB', t.errorRate + '%']);
      cells.forEach(function (v) { tr.appendChild(el('td', 'num', v)); }); tbody.appendChild(tr);
    });
  }

  // ------------------------------------------------------------ views
  var VIEWS = ['overview', 'people', 'person', 'access', 'tools', 'cloud', 'connections', 'activity', 'settings'];
  var TITLES = { overview: 'Overview', people: 'People', person: 'Person', access: 'Access', tools: 'Tools', cloud: 'Cloud', connections: 'Connections', activity: 'Activity', settings: 'Settings' };

  function renderOverview(d) {
    var al = clear($('alerts')); d.alerts.forEach(function (a) { al.appendChild(el('div', 'alert' + (a.level === 'bad' ? ' bad' : ''), a.text)); });
    var k = d.totals;
    [['people', 'People'], ['activeToday', 'Active today'], ['active7', 'Active, 7 days'], ['requestsToday', 'Requests today'], ['toolCallsToday', 'Tool calls today'], ['changesToday', 'Changes today']]
      .forEach(function (p) { text($('k-' + p[0]), num(k[p[0]])); });
    cols($('daily'), d.daily.map(function (x) { return { v: x.requests, label: x.day }; }));
    text($('dailyFrom'), day(d.daily[0] && d.daily[0].day));
    rank($('topPeople'), d.people.slice(0, 5).map(function (p) { return { label: personLink(p), v: p.share, text: p.share + '%' }; }));
    rank($('topTools'), d.tools.slice(0, 5).map(function (t) { return { label: el('span', '', tool(t.name)), v: t.calls, text: num(t.calls) }; }));
    var c = d.cloud, cs = clear($('cloudSummary'));
    if (!c || !c.configured) cs.appendChild(el('p', 'muted', 'Not set up yet. See Cloud.'));
    else if (c.error) cs.appendChild(el('p', 'muted', 'Could not read Cloudflare analytics.'));
    else {
      cs.appendChild(el('div', 'big', '$' + c.costNow.toFixed(2)));
      cs.appendChild(el('p', 'muted', 'this month on ' + c.plan));
      var top = c.limits.slice().sort(function (a, b) { return b.percent - a.percent; })[0];
      var row = el('div', 'limitrow'); row.style.marginTop = '12px'; row.appendChild(el('span', '', 'Closest free limit: ' + top.label + ', ' + top.percent + '%'));
      var m = el('div', 'meter'); var i = el('i', top.percent >= 80 ? 'hot' : ''); i.style.width = Math.min(100, top.percent) + '%'; m.appendChild(i); row.appendChild(m); cs.appendChild(row);
    }
  }

  function renderPeople(d) {
    var tb = clear($('people'));
    if (!d.people.length) return empty(tb, 10, 'No usage recorded yet. Usage is counted from v0.8.0 on.');
    var max = Math.max.apply(null, d.people.map(function (p) { return p.share; }).concat([1]));
    d.people.forEach(function (p) {
      var tr = el('tr'); var td = el('td'); td.appendChild(personLink(p)); tr.appendChild(td);
      tr.appendChild(el('td', '', p.apps.join(', ') || '—'));
      tr.appendChild(el('td', 'num', num(p.totals.requests)));
      var s = el('td'); var w = el('div', 'share'); var bar = el('i'); bar.style.width = Math.max(2, p.share / max * 90) + 'px'; w.appendChild(bar); w.appendChild(el('span', '', p.share + '%')); s.appendChild(w); tr.appendChild(s);
      [p.totals.toolCalls, p.totals.changes, p.totals.searches, p.totals.errors].forEach(function (v) { tr.appendChild(el('td', 'num', num(v))); });
      tr.appendChild(el('td', '', tool(p.topTool))); tr.appendChild(el('td', '', when(p.lastActive)));
      tb.appendChild(tr);
    });
    text($('privacy'), d.privacy);
  }

  function renderTools(d) { toolTable($('tools'), d.tools, true); heat($('hours'), d.hours); }

  function renderCloud(d) {
    var c = d.cloud, box = clear($('cloud'));
    if (!c || !c.configured) { box.appendChild(el('p', 'muted', (c && c.note) || 'Cloud usage is not set up.')); return; }
    if (c.error) { box.appendChild(el('p', 'muted', 'Could not read Cloudflare analytics: ' + c.error)); return; }
    var top = el('div', 'two');
    var left = el('div'); left.appendChild(el('div', 'big', '$' + c.costNow.toFixed(2)));
    left.appendChild(el('p', 'muted', 'Spent this month on ' + c.plan + '. At this month\\'s pace the paid plan would cost about $' + c.paidEstimate.total.toFixed(2) + '/month ($5 base + usage).'));
    var dl = el('dl', 'facts'); dl.style.marginTop = '14px';
    facts(dl, [['Requests this month', num(c.month.requests)], ['Projected for 30 days', num(c.projectedMonth.requests)], ['Errors this month', num(c.month.errors)],
      ['CPU per request (median, today)', c.today.cpuP50Ms + ' ms'], ['Database rows read / written this month', num(c.month.rowsRead) + ' / ' + num(c.month.rowsWritten)]]);
    left.appendChild(dl);
    var right = el('div'); right.appendChild(el('h2', '', 'Free plan limits'));
    c.limits.forEach(function (l) {
      var row = el('div', 'limitrow'); row.appendChild(el('span', '', l.label + ': ' + num(l.used) + ' of ' + num(l.limit) + ' (' + l.percent + '%)'));
      var m = el('div', 'meter'); var i = el('i', l.percent >= 80 ? 'hot' : ''); i.style.width = Math.min(100, l.percent) + '%'; m.appendChild(i); row.appendChild(m); right.appendChild(row);
    });
    right.appendChild(el('p', 'muted', 'From Cloudflare analytics, a few minutes behind. Updated ' + when(c.asOf) + '.'));
    top.appendChild(left); top.appendChild(right); box.appendChild(top);
  }

  function renderConnections(d) {
    var tb = clear($('conn'));
    if (!d.connections.length) return empty(tb, 6, 'No connections yet.');
    d.connections.forEach(function (c) {
      var tr = el('tr');
      [c.person || 'Unknown', c.app || 'Unknown (before v0.7.1)', when(c.createdAt), when(c.lastUsedAt), day(c.expiresAt)].forEach(function (v) { tr.appendChild(el('td', '', v)); });
      var td = el('td'); var b = el('button', 'end', 'End connection'); b.type = 'button';
      b.addEventListener('click', async function () {
        if (!confirm('End this connection? The app using it will need to sign in again.')) return;
        await api('/admin/api/connections/' + c.id + '/end', { method: 'POST' }); load(true);
      });
      td.appendChild(b); tr.appendChild(td); tb.appendChild(tr);
    });
  }

  function renderActivity(d) {
    var a = d.adoption;
    facts($('adoption'), [['Active today / 7 days / 30 days', a.activeToday + ' / ' + a.active7 + ' / ' + a.active30], ['New people this week', a.newThisWeek],
      ['Connected but never used', a.neverUsed], ['Idle for 30+ days', a.idle30], ['Ending within 14 days (unused)', a.expiring14],
      ['Apps', Object.keys(a.appMix).map(function (x) { return x + ' ' + a.appMix[x]; }).join(', ') || '—'], ['Registered apps', d.totals.registeredApps], ['Connections', d.totals.connections]]);
    var names = { signin: 'Sign-ins', signout: 'Sign-outs', expired: 'Expired (90 days unused)', signin_not_allowed: 'Refused: not on allow-list', signin_bad_access_code: 'Refused: wrong access code',
      rate_limited_ip: 'Rate-limited (per IP)', rate_limited_user: 'Rate-limited (per person)', rate_limited_heavy: 'Search limit hit', rate_limited_write: 'Change limit hit', daily_write_cap: 'Daily change cap hit',
      admin_signin_failed: 'Failed admin sign-ins', admin_ended_connection: 'Connections ended by admin', error: 'Server errors', cleanup_run: 'Nightly cleanups' };
    var keys = Object.keys(names).filter(function (m) { return d.events[m] !== undefined; });
    if (keys.length) facts($('events'), keys.map(function (m) { return [names[m], num(d.events[m])]; })); else { clear($('events')); $('events').appendChild(el('dd', 'empty', 'Nothing yet.')); }
  }

  function renderSettings(d) {
    var s = d.settings, l = d.limits, m = d.microsoft;
    facts($('settings'), [['Version', 'v' + d.version], ['Access', s.restricted ? 'Restricted (see Access)' : 'Open to any personal account'], ['Access code required', s.accessCodeRequired ? 'Yes' : 'No'], ['Allow-list', s.allowListSize ? s.allowListSize + ' accounts' : 'Off'],
      ['Personal URLs', s.personalUrls ? 'On' : 'Off (connectors only)'], ['New-connection notes', s.alerts ? 'On' : 'Off'], ['Last nightly cleanup', d.lastCleanup || 'Not yet']]);
    facts($('limits'), [['Requests', l.requestsPerMinute + ' a minute per person'], ['Searches across chats', l.searchesPerMinute + ' a minute per person'],
      ['Changes', l.changesPerMinute + ' a minute and ' + l.changesPerDay + ' a day per person'], ['Connections end after', l.inactiveDays + ' days unused']]);
    facts($('microsoft'), [['Shown to people as', m.shownAs], ['Microsoft app id', m.clientId], ['Where people manage it', m.permissionsPage.replace('https://', '')]]);
    text($('msnote'), m.note);
  }

  async function renderPerson(key) {
    clear($('pFacts')); text($('pName'), 'Loading…');
    var r = await api('/admin/api/person/' + encodeURIComponent(key)); if (r.status === 401) return showSignin();
    var d = await r.json(); if (!r.ok) { text($('pName'), d.error || 'Could not load this person.'); return; }
    var p = d.person;
    text($('pName'), p.name || 'Unknown person'); document.title = (p.name || 'Person') + ' · Admin';
    [['pReq', p.totals.requests], ['pTools', p.totals.toolCalls], ['pChanges', p.totals.changes], ['pSearch', p.totals.searches]].forEach(function (x) { text($(x[0]), num(x[1])); });
    facts($('pFacts'), [['First connected', day(p.firstConnected)], ['Last active', when(p.lastActive)], ['Active days (30)', p.activeDays], ['Apps', p.apps.join(', ')],
      ['Connections', p.connections], ['Share of all requests', p.share + '%'], ['Data returned to Claude (30 days)', num(p.totals.kb) + ' KB'], ['Calls to Microsoft (30 days)', num(p.totals.teamsCalls)]]);
    cols($('pDaily'), d.daily.map(function (x) { return { v: x.toolCalls, label: x.day, w: x.changes }; }), function (v) { return v.w > 0; });
    heat($('pHours'), d.hours);
    toolTable($('pToolTable'), d.tools, false);
    var avg = p.totals.toolCalls ? Math.round(p.totals.ms / p.totals.toolCalls) : 0;
    facts($('pHealth'), [['Errors (30 days)', num(p.totals.errors)], ['Refused by limits', num(p.totals.rateLimited)], ['Slowed down by Microsoft', num(p.totals.throttled)], ['Average tool time', avg + ' ms']]);
    text($('pCapToday'), p.today.changes + ' of ' + p.dailyCap + ' changes used today (' + p.capUsedToday + '%)');
    var mi = $('pCapMeter'); mi.style.width = Math.min(100, p.capUsedToday) + '%'; mi.className = p.capUsedToday >= 80 ? 'hot' : '';
    $('pCap').value = d.capOverride == null ? '' : d.capOverride; $('pCap').placeholder = String(d.defaultCap); text($('pCapMsg'), 'Leave empty to use the default.');
    $('pCapSave').onclick = async function () {
      var v = $('pCap').value.trim(); var body = { dailyWrites: v === '' ? null : Number(v) };
      var rr = await api('/admin/api/person/' + encodeURIComponent(key) + '/limit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var jj = await rr.json(); text($('pCapMsg'), rr.ok ? (jj.dailyWrites == null ? 'Back to the default limit.' : 'Saved: ' + jj.dailyWrites + ' changes a day.') : jj.error);
    };
    $('pCsv').href = '/admin/api/person/' + encodeURIComponent(key) + '/csv';
    $('pEnd').onclick = async function () {
      if (!confirm('End all connections for ' + (p.name || 'this person') + '? Their apps will need to sign in again.')) return;
      var rr = await api('/admin/api/person/' + encodeURIComponent(key) + '/end', { method: 'POST' }); var jj = await rr.json();
      text($('pCapMsg'), 'Ended ' + (jj.ended || 0) + ' connection(s).'); data = null;
    };
  }

  // ------------------------------------------------------------ access
  async function post(path, body) {
    var r = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || 'That did not work.');
    return j;
  }
  function act(label, cls, fn) { var b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function acts(tr, buttons) { var td = el('td'); var w = el('div', 'acts'); buttons.forEach(function (b) { w.appendChild(b); }); td.appendChild(w); tr.appendChild(td); }
  function personCell(tr, p, link) { var td = el('td'); td.appendChild(link ? personLink(p) : el('span', '', p.name || 'Unknown person')); tr.appendChild(td); }
  function how(p, groups) {
    var v = p.via || '';
    if (v.indexOf('group:') === 0) return 'Group: ' + (groups[v.slice(6)] || 'a Teams group');
    if (v.indexOf('invite:') === 0) return 'Invite' + (v.length > 7 ? ': ' + v.slice(7) : '');
    return { admin: 'Approved by you', 'allow-list': 'Allow-list', 'connected before': 'Connected before access was restricted', 'left group': 'Left their group' }[v] || '—';
  }
  function decide(p, action, question) {
    return async function () {
      if (question && !confirm(question)) return;
      try { await post('/admin/api/access/people/' + p.key + '/' + action); } catch (e) { alert(e.message); }
      load(true);
    };
  }
  async function renderAccess() {
    var r = await api('/admin/api/access'); if (r.status === 401) return showSignin();
    var a = await r.json(), groups = a.groupNames || {};
    $('modeRestricted').setAttribute('aria-pressed', String(a.restricted)); $('modeOpen').setAttribute('aria-pressed', String(!a.restricted));
    text($('modeNote'), a.restricted
      ? 'Restricted' + (a.restrictedSince ? ' since ' + day(a.restrictedSince) : '') + ': only members of the groups below, invited and approved people can connect. Everyone else is refused, nothing of theirs is stored, and they wait here.'
      : 'Open: any personal Microsoft account can connect to this server.');

    var waiting = a.people.filter(function (p) { return p.status === 'pending' || p.status === 'review'; });
    text($('waitingCount'), waiting.length ? '(' + waiting.length + ')' : '');
    var tb = clear($('aWaiting'));
    if (!waiting.length) empty(tb, 5, 'Nobody is waiting.');
    waiting.forEach(function (p) {
      var tr = el('tr'); personCell(tr, p, p.status === 'review');
      tr.appendChild(el('td', '', p.status === 'review' ? 'Already connected (still works)' : p.via === 'left group' ? 'Left their group' : 'Asked to join'));
      tr.appendChild(el('td', '', when(p.requestedAt || p.updatedAt)));
      tr.appendChild(el('td', 'num', p.status === 'pending' ? p.attempts : '—'));
      acts(tr, [act('Approve', 'go', decide(p, 'approve')),
        p.status === 'review' ? act('Remove', 'end', decide(p, 'remove', 'Remove ' + (p.name || 'this person') + ' and end their connections?'))
          : act('Block', 'end', decide(p, 'block', 'Block ' + (p.name || 'this person') + '? They will not be able to ask again.'))]);
      tb.appendChild(tr);
    });

    tb = clear($('aGroups'));
    if (!a.groups.length) empty(tb, 4, 'No groups yet. Add one below.');
    a.groups.forEach(function (g) {
      var tr = el('tr'); tr.appendChild(el('td', '', g.name || 'Name shows after the first check'));
      var idc = el('td'); idc.appendChild(el('code', '', g.id.length > 22 ? g.id.slice(0, 22) + '…' : g.id)); idc.title = g.id; tr.appendChild(idc);
      tr.appendChild(el('td', 'num', g.members));
      acts(tr, [act('Remove', 'end', async function () {
        if (!confirm('Remove this group? Its members lose access at their next daily check, unless another group or an approval lets them in.')) return;
        try { await post('/admin/api/access/groups/remove', { conversationId: g.id }); } catch (e) { alert(e.message); }
        load(true);
      })]);
      tb.appendChild(tr);
    });

    tb = clear($('aInvites'));
    if (!a.invites.length) empty(tb, 5, 'No invite links yet.');
    a.invites.forEach(function (i) {
      var tr = el('tr'); tr.appendChild(el('td', '', i.label || '—'));
      tr.appendChild(el('td', 'num', i.usesLeft)); tr.appendChild(el('td', 'num', i.used));
      tr.appendChild(el('td', '', i.active ? day(i.expiresAt) : 'Ended'));
      acts(tr, i.active ? [act('Revoke', 'end', async function () {
        if (!confirm('Revoke this invite link? People who already joined keep access.')) return;
        try { await post('/admin/api/access/invites/' + i.id + '/revoke'); } catch (e) { alert(e.message); }
        load(true);
      })] : []);
      tb.appendChild(tr);
    });

    var allowed = a.people.filter(function (p) { return p.status === 'member' || p.status === 'approved'; });
    tb = clear($('aAllowed'));
    if (!allowed.length) empty(tb, 4, 'Nobody yet.');
    allowed.forEach(function (p) {
      var tr = el('tr'); personCell(tr, p, true);
      tr.appendChild(el('td', '', how(p, groups))); tr.appendChild(el('td', '', day(p.updatedAt)));
      acts(tr, [act('Remove', 'end', decide(p, 'remove', 'Remove ' + (p.name || 'this person') + '? Their connections end now; they can ask again or get in through a group.')),
        act('Block', 'end', decide(p, 'block', 'Block ' + (p.name || 'this person') + '? Their connections end now and they cannot get back in.'))]);
      tb.appendChild(tr);
    });

    var blocked = a.people.filter(function (p) { return p.status === 'blocked'; });
    tb = clear($('aBlocked'));
    if (!blocked.length) empty(tb, 3, 'Nobody is blocked.');
    blocked.forEach(function (p) {
      var tr = el('tr'); personCell(tr, p, false); tr.appendChild(el('td', '', day(p.updatedAt)));
      acts(tr, [act('Unblock', 'go', decide(p, 'unblock'))]);
      tb.appendChild(tr);
    });
  }

  var RENDER = { access: renderAccess, overview: renderOverview, people: renderPeople, tools: renderTools, cloud: renderCloud, connections: renderConnections, activity: renderActivity, settings: renderSettings };

  function route(keepScroll) {
    var h = decodeURIComponent((location.hash || '#overview').slice(1));
    var parts = h.split('/'); var view = VIEWS.indexOf(parts[0]) >= 0 ? parts[0] : 'overview';
    VIEWS.forEach(function (v) { $('v-' + v).hidden = v !== view; });
    Array.prototype.forEach.call(document.querySelectorAll('.menu a'), function (a) {
      var target = a.getAttribute('href').slice(1); var on = target === view || (view === 'person' && target === 'people');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = TITLES[view] + ' · Admin';
    if (!keepScroll) window.scrollTo(0, 0);
    if (view === 'person') return renderPerson(parts.slice(1).join('/'));
    if (data) RENDER[view](data);
  }

  function updateMenu(d) {
    text($('c-people'), d.people.length); text($('c-connections'), d.connections.length);
    var w = (d.access && d.access.waiting) || 0, ca = $('c-access'); ca.textContent = w ? String(w) : ''; ca.className = 'count' + (w ? ' hot' : '');
    $('alertDot').hidden = !d.alerts.length; text($('ver'), 'v' + d.version);
  }

  function showSignin() {
    $('app').hidden = true; $('signinForm').hidden = document.body.getAttribute('data-configured') !== '1';
  }

  async function load(force) {
    if (loading && !force) return loading;
    loading = (async function () {
      var r = await api('/admin/api/overview');
      if (r.status === 401) { showSignin(); return; }
      data = await r.json();
      $('signinForm').hidden = true; $('app').hidden = false;
      updateMenu(data); route(force);
    })();
    try { await loading; } finally { loading = null; }
  }

  window.addEventListener('hashchange', function () { if (!data) load(); else route(); });
  $('signinForm').addEventListener('submit', async function (e) {
    e.preventDefault(); $('err').textContent = '';
    var r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { $('err').textContent = j.error || 'Sign-in failed.'; return; }
    $('p').value = ''; load(true);
  });
  $('out').addEventListener('click', async function () { await api('/admin/logout', { method: 'POST' }); data = null; showSignin(); });
  $('refresh').addEventListener('click', function () { load(true); });
  async function setMode(mode) {
    if (mode === 'open' && !confirm('Open access? Any personal Microsoft account will be able to connect.')) return;
    try { await post('/admin/api/access/mode', { mode: mode }); } catch (e) { alert(e.message); }
    load(true);
  }
  $('modeRestricted').addEventListener('click', function () { setMode('restricted'); });
  $('modeOpen').addEventListener('click', function () { setMode('open'); });
  $('groupForm').addEventListener('submit', async function (e) {
    e.preventDefault(); $('gMsg').textContent = '';
    try { await post('/admin/api/access/groups', { conversationId: $('gId').value.trim(), name: $('gName').value.trim() }); $('gId').value = ''; $('gName').value = ''; load(true); }
    catch (err) { $('gMsg').textContent = err.message; }
  });
  $('inviteForm').addEventListener('submit', async function (e) {
    e.preventDefault(); $('iMsg').textContent = '';
    try {
      var j = await post('/admin/api/access/invites', { label: $('iLabel').value.trim(), uses: Number($('iUses').value), days: Number($('iDays').value) });
      $('newLinkText').textContent = j.link; $('newLink').hidden = false; $('iLabel').value = ''; load(true);
    } catch (err) { $('iMsg').textContent = err.message; }
  });
  $('copyLink').addEventListener('click', function () {
    navigator.clipboard.writeText($('newLinkText').textContent).then(function () { $('copyLink').textContent = 'Copied'; setTimeout(function () { $('copyLink').textContent = 'Copy link'; }, 1500); });
  });
  load();
})();`;

const kpi = (id, label) => `<div class="kpi"><b id="${id}"></b><span>${label}</span></div>`;

export function renderAdminPage({ configured }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin · Teams Personal MCP</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body data-configured="${configured ? '1' : '0'}">

<form class="signin" id="signinForm" hidden>
  <h1>Admin</h1>
  <label>Username<input id="u" autocomplete="username" required></label>
  <label>Password<input id="p" type="password" autocomplete="current-password" required></label>
  <button class="btn" type="submit">Sign in</button>
  <p class="err" id="err" role="alert"></p>
</form>
${configured ? '' : `<div class="notset"><h1>Admin</h1><p>Admin sign-in is not set up yet. Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> (at least ${MIN_PASSWORD} characters) in Cloudflare, then reload.</p></div>`}

<div class="app" id="app" hidden>
  <aside class="side" aria-label="Admin menu">
    <a class="word" href="/">Teams Personal MCP</a>
    <span class="sub">Admin</span>
    <nav><ul class="menu">
      <li><a href="#overview">Overview <span class="dot" id="alertDot" hidden title="Alerts"></span></a></li>
      <li><a href="#people">People <span class="count" id="c-people"></span></a></li>
      <li><a href="#access">Access <span class="count" id="c-access"></span></a></li>
      <li><a href="#tools">Tools</a></li>
      <li><a href="#cloud">Cloud</a></li>
      <li><a href="#connections">Connections <span class="count" id="c-connections"></span></a></li>
      <li><a href="#activity">Activity</a></li>
      <li><a href="#settings">Settings</a></li>
    </ul></nav>
    <div class="foot">
      <button class="link" type="button" id="refresh">Refresh</button>
      <a href="/changelog">Changelog</a>
      <button class="link" type="button" id="out">Sign out</button>
      <span class="muted ver" id="ver"></span>
    </div>
  </aside>

  <main class="content">
    <section class="view" id="v-overview" aria-labelledby="h-overview">
      <div class="head"><h1 id="h-overview">Overview</h1></div>
      <div class="alerts" id="alerts" aria-live="polite"></div>
      <div class="kpis">${kpi('k-people', 'People')}${kpi('k-activeToday', 'Active today')}${kpi('k-active7', 'Active, 7 days')}${kpi('k-requestsToday', 'Requests today')}${kpi('k-toolCallsToday', 'Tool calls today')}${kpi('k-changesToday', 'Changes today')}</div>
      <div class="three">
        <div><h2>Requests per day</h2><div class="cols" id="daily"></div><div class="axis"><span id="dailyFrom"></span><span>today</span></div></div>
        <div class="tile"><h2>Cloud</h2><div id="cloudSummary"></div></div>
      </div>
      <div class="two">
        <div><h2>Top people <a class="link" href="#people" style="font-size:.85rem;font-weight:400">all</a></h2><ul class="rank" id="topPeople"></ul></div>
        <div><h2>Top tools <a class="link" href="#tools" style="font-size:.85rem;font-weight:400">all</a></h2><ul class="rank" id="topTools"></ul></div>
      </div>
    </section>

    <section class="view" id="v-people" hidden aria-labelledby="h-people">
      <div class="head"><h1 id="h-people">People</h1><span class="muted">Last 30 days</span></div>
      <div class="scroll"><table><thead><tr><th>Person</th><th>Apps</th><th class="num">Requests</th><th>Share</th><th class="num">Tool calls</th><th class="num">Changes</th><th class="num">Searches</th><th class="num">Errors</th><th>Top tool</th><th>Last active</th></tr></thead><tbody id="people"></tbody></table></div>
      <p class="muted" id="privacy"></p>
    </section>

    <section class="view" id="v-person" hidden aria-labelledby="pName">
      <div class="head"><h1 id="pName"></h1><a class="link" href="#people">← All people</a></div>
      <div class="kpis">${kpi('pReq', 'Requests, 30 days')}${kpi('pTools', 'Tool calls')}${kpi('pChanges', 'Changes')}${kpi('pSearch', 'Searches')}</div>
      <div class="two">
        <div><h2>About</h2><dl class="facts" id="pFacts"></dl></div>
        <div><h2>Daily change limit</h2>
          <p class="muted" id="pCapToday"></p><div class="meter" style="margin:8px 0 14px"><i id="pCapMeter"></i></div>
          <div class="cap"><label class="muted" for="pCap">Changes a day for this person</label><input id="pCap" inputmode="numeric"><button class="btn quiet" type="button" id="pCapSave">Save</button></div>
          <p class="muted" id="pCapMsg" style="margin-top:8px"></p>
          <div class="actions" style="margin-top:18px"><a class="btn quiet" id="pCsv" href="#" download>Export CSV</a><button class="btn" type="button" id="pEnd">End all connections</button></div>
        </div>
      </div>
      <div class="two">
        <div><h2>Tool calls per day</h2><div class="cols" id="pDaily"></div><p class="muted" style="margin-top:6px">Red days include changes to Teams.</p></div>
        <div><h2>When they use it (UTC)</h2><div class="heat" id="pHours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div>
      </div>
      <div class="three">
        <div><h2>Their tools</h2><div class="scroll"><table><thead><tr><th>Tool</th><th class="num">Calls</th><th class="num">Avg time</th><th class="num">Avg size</th><th class="num">Errors</th></tr></thead><tbody id="pToolTable"></tbody></table></div></div>
        <div><h2>Health</h2><dl class="facts" id="pHealth"></dl></div>
      </div>
    </section>

    <section class="view" id="v-access" hidden aria-labelledby="h-access">
      <div class="head"><h1 id="h-access">Access</h1>
        <div class="seg" role="group" aria-label="Who can connect"><button type="button" id="modeRestricted" aria-pressed="false">Restricted</button><button type="button" id="modeOpen" aria-pressed="false">Open</button></div></div>
      <p class="muted" id="modeNote" style="max-width:80ch;margin-top:-20px"></p>
      <div><h2>Waiting <span class="muted" id="waitingCount"></span></h2>
        <div class="scroll"><table><thead><tr><th>Person</th><th>Why</th><th>When</th><th class="num">Tries</th><th></th></tr></thead><tbody id="aWaiting"></tbody></table></div></div>
      <div><h2>Teams groups</h2>
        <p class="muted sub2">Members of these group chats get in automatically and are re-checked daily; leaving the group ends their access. To find a group's id, ask Claude: “What is the chat id of the … group?”</p>
        <div class="scroll"><table><thead><tr><th>Group</th><th>Chat id</th><th class="num">People in</th><th></th></tr></thead><tbody id="aGroups"></tbody></table></div>
        <form class="inline" id="groupForm"><input class="grow" id="gId" placeholder="19:…@thread.v2" aria-label="Group chat id" required spellcheck="false" autocomplete="off"><input id="gName" placeholder="Name (optional)" aria-label="Group name"><button class="btn quiet" type="submit">Add group</button></form>
        <p class="err" id="gMsg" role="alert"></p></div>
      <div><h2>Invite links</h2>
        <p class="muted sub2">For people outside your groups, such as customers. Whoever signs in through the link has access until you remove them.</p>
        <form class="inline" id="inviteForm"><input class="grow" id="iLabel" placeholder="Label, e.g. Acme team" aria-label="Invite label"><label class="muted">Uses <input id="iUses" type="number" min="1" max="500" value="1"></label><label class="muted">Days <input id="iDays" type="number" min="1" max="30" value="7"></label><button class="btn quiet" type="submit">Create link</button></form>
        <p class="err" id="iMsg" role="alert"></p>
        <div class="newlink" id="newLink" hidden><code id="newLinkText"></code><button class="btn" type="button" id="copyLink">Copy link</button><span class="muted">Shown once. Send it to the people you invite.</span></div>
        <div class="scroll" style="margin-top:12px"><table><thead><tr><th>Label</th><th class="num">Uses left</th><th class="num">Used</th><th>Ends</th><th></th></tr></thead><tbody id="aInvites"></tbody></table></div></div>
      <div><h2>People with access</h2>
        <div class="scroll"><table><thead><tr><th>Person</th><th>How</th><th>Since</th><th></th></tr></thead><tbody id="aAllowed"></tbody></table></div></div>
      <div><h2>Blocked</h2>
        <div class="scroll"><table><thead><tr><th>Person</th><th>Since</th><th></th></tr></thead><tbody id="aBlocked"></tbody></table></div></div>
    </section>

    <section class="view" id="v-tools" hidden aria-labelledby="h-tools">
      <div class="head"><h1 id="h-tools">Tools</h1><span class="muted">Last 30 days</span></div>
      <div class="scroll"><table><thead><tr><th>Tool</th><th class="num">Calls</th><th class="num">People</th><th class="num">Avg time</th><th class="num">Avg size</th><th class="num">Errors</th></tr></thead><tbody id="tools"></tbody></table></div>
      <p class="muted">Avg size is the data each call returns to the assistant: larger results use more of people's Claude context.</p>
      <div><h2>Busiest hours (UTC)</h2><div class="heat" id="hours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div>
    </section>

    <section class="view" id="v-cloud" hidden aria-labelledby="h-cloud">
      <div class="head"><h1 id="h-cloud">Cloud</h1><span class="muted">Cloudflare usage and cost</span></div>
      <div id="cloud"></div>
    </section>

    <section class="view" id="v-connections" hidden aria-labelledby="h-conn">
      <div class="head"><h1 id="h-conn">Connections</h1></div>
      <div class="scroll"><table><thead><tr><th>Person</th><th>App</th><th>Created</th><th>Last used</th><th>Ends if unused by</th><th></th></tr></thead><tbody id="conn"></tbody></table></div>
    </section>

    <section class="view" id="v-activity" hidden aria-labelledby="h-act">
      <div class="head"><h1 id="h-act">Activity</h1></div>
      <div class="two">
        <div><h2>Adoption and upkeep</h2><dl class="facts" id="adoption"></dl></div>
        <div><h2>Events, last 14 days</h2><dl class="facts" id="events"></dl></div>
      </div>
    </section>

    <section class="view" id="v-settings" hidden aria-labelledby="h-set">
      <div class="head"><h1 id="h-set">Settings</h1></div>
      <div class="two">
        <div><h2>Server</h2><dl class="facts" id="settings"></dl></div>
        <div><h2>Limits per person</h2><dl class="facts" id="limits"></dl></div>
      </div>
      <div><h2>On Microsoft's side</h2><dl class="facts" id="microsoft"></dl><p class="muted" id="msnote" style="margin-top:10px;max-width:70ch"></p></div>
    </section>
  </main>
</div>
<script>${SCRIPT}</script>
</body></html>`;
}
