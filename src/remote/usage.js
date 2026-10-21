// Per-person usage: counted during each MCP request, written in one D1 batch at the end.
// Numbers only: tool names, counts, durations and sizes — never message text, chat names or contacts.

const DAY_MS = 24 * 60 * 60 * 1000;
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** Collects counters for one request; flush() writes them as upserts (one row per metric). */
export function usageRecorder({ userId, accountHash, now = Date.now() }) {
  const counts = new Map();
  const add = (metric, n = 1) => { if (n) counts.set(metric, (counts.get(metric) || 0) + n); };
  add('request');
  add(`hour:${String(new Date(now).getUTCHours()).padStart(2, '0')}`);
  return {
    add,
    tool(name, kind, { ms, bytes, isError, refused }) {
      add(`tool:${name}`);
      add(`ms:${name}`, Math.max(0, Math.round(ms)));
      add(`kb:${name}`, Math.round(bytes / 1024));
      if (isError) add(`error:${name}`);
      if (refused) add('rate_limited');
      if (!refused && !isError && (kind === 'write' || kind === 'destructive')) add('write');
      if (!refused && kind === 'heavy') add('heavy');
    },
    entries: () => [...counts],
    statements(env) {
      const day = dayOf(now);
      return [...counts].map(([metric, n]) => env.DB.prepare(
        'INSERT INTO usage_daily (day, user_id, account_hash, metric, count) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(day, user_id, metric) DO UPDATE SET count = count + excluded.count, account_hash = COALESCE(excluded.account_hash, usage_daily.account_hash)',
      ).bind(day, userId, accountHash || null, metric, n));
    },
  };
}

// ---------------------------------------------------------------- reporting (pure functions over D1 rows)

const personKey = (accountHash, userId) => accountHash || `conn:${userId}`;

function emptyTotals() {
  return { requests: 0, toolCalls: 0, changes: 0, searches: 0, errors: 0, rateLimited: 0, throttled: 0, teamsCalls: 0, kb: 0, ms: 0 };
}

function addMetric(t, metric, n) {
  if (metric === 'request') t.requests += n;
  else if (metric === 'write') t.changes += n;
  else if (metric === 'heavy') t.searches += n;
  else if (metric === 'rate_limited') t.rateLimited += n;
  else if (metric === 'throttled') t.throttled += n;
  else if (metric === 'teams_call') t.teamsCalls += n;
  else if (metric.startsWith('tool:')) t.toolCalls += n;
  else if (metric.startsWith('error:')) t.errors += n;
  else if (metric.startsWith('kb:')) t.kb += n;
  else if (metric.startsWith('ms:')) t.ms += n;
}

function lastDays(n, now) {
  return Array.from({ length: n }, (_, i) => dayOf(now - (n - 1 - i) * DAY_MS));
}

/** Per-tool table: calls, average time, average size, error rate. */
function toolTable(rows) {
  const tools = {};
  for (const r of rows) {
    const [kind, name] = [r.metric.split(':')[0], r.metric.slice(r.metric.indexOf(':') + 1)];
    if (!['tool', 'ms', 'kb', 'error'].includes(kind)) continue;
    const t = (tools[name] ||= { name, calls: 0, ms: 0, kb: 0, errors: 0, people: new Set() });
    if (kind === 'tool') { t.calls += r.count; t.people.add(personKey(r.account_hash, r.user_id)); }
    if (kind === 'ms') t.ms += r.count;
    if (kind === 'kb') t.kb += r.count;
    if (kind === 'error') t.errors += r.count;
  }
  return Object.values(tools).filter((t) => t.calls).map((t) => ({
    name: t.name,
    calls: t.calls,
    people: t.people.size,
    avgMs: Math.round(t.ms / t.calls),
    avgKb: Math.round((t.kb / t.calls) * 10) / 10,
    errorRate: Math.round((t.errors / t.calls) * 1000) / 10,
  })).sort((a, b) => b.calls - a.calls);
}

/**
 * @param rows usage_daily rows ({day, user_id, account_hash, metric, count}) for the period
 * @param connections live connections ({id, accountHash, person, app, createdAt, lastUsedAt, expiresAt})
 * @param people known people ({account_hash, name, first_seen, last_seen})
 */
export function buildInsights({ rows, connections, people, now = Date.now(), days = 30, dailyCap = 200, overrides = {} }) {
  const today = dayOf(now);
  const names = new Map(people.map((p) => [p.account_hash, p.name]));
  for (const c of connections) if (c.accountHash && c.person && !names.get(c.accountHash)) names.set(c.accountHash, c.person);

  // ---- people
  const byPerson = new Map();
  const ensure = (key) => {
    if (!byPerson.has(key)) byPerson.set(key, { key, name: names.get(key) || null, totals: emptyTotals(), today: emptyTotals(), tools: {}, connections: [], apps: new Set(), activeDays: new Set() });
    return byPerson.get(key);
  };
  for (const r of rows) {
    const p = ensure(personKey(r.account_hash, r.user_id));
    addMetric(p.totals, r.metric, r.count);
    if (r.day === today) addMetric(p.today, r.metric, r.count);
    if (r.metric === 'request') p.activeDays.add(r.day);
    if (r.metric.startsWith('tool:')) p.tools[r.metric.slice(5)] = (p.tools[r.metric.slice(5)] || 0) + r.count;
  }
  for (const c of connections) {
    const p = ensure(personKey(c.accountHash, c.id));
    p.connections.push(c);
    if (c.app) p.apps.add(c.app);
    if (!p.name && c.person) p.name = c.person;
  }
  const totalRequests = [...byPerson.values()].reduce((n, p) => n + p.totals.requests, 0) || 1;
  const firstSeen = new Map(people.map((p) => [p.account_hash, p.first_seen]));
  const peopleList = [...byPerson.values()].map((p) => {
    const lastActive = [...p.connections.map((c) => Date.parse(c.lastUsedAt)), ...[...p.activeDays].map((d) => Date.parse(d + 'T00:00:00Z'))]
      .reduce((a, b) => Math.max(a, b), 0) || null;
    const top = Object.entries(p.tools).sort((a, b) => b[1] - a[1])[0];
    const cap = overrides[p.key] ?? dailyCap;
    return {
      key: p.key,
      name: p.name,
      apps: [...p.apps],
      connections: p.connections.length,
      firstConnected: firstSeen.get(p.key) ? new Date(firstSeen.get(p.key)).toISOString()
        : (p.connections.length ? p.connections.map((c) => c.createdAt).sort()[0] : null),
      lastActive: lastActive ? new Date(lastActive).toISOString() : null,
      activeDays: p.activeDays.size,
      totals: p.totals,
      today: p.today,
      share: Math.round((p.totals.requests / totalRequests) * 1000) / 10,
      topTool: top ? top[0] : null,
      dailyCap: cap,
      capUsedToday: Math.round((p.today.changes / cap) * 100),
    };
  }).sort((a, b) => b.totals.requests - a.totals.requests);

  // ---- trends
  const series = Object.fromEntries(lastDays(days, now).map((d) => [d, emptyTotals()]));
  const hours = Array(24).fill(0);
  for (const r of rows) {
    if (series[r.day]) addMetric(series[r.day], r.metric, r.count);
    if (r.metric.startsWith('hour:')) hours[Number(r.metric.slice(5))] += r.count;
  }

  // ---- adoption + upkeep
  const activeWithin = (ms) => peopleList.filter((p) => p.lastActive && now - Date.parse(p.lastActive) < ms).length;
  const usedConnections = new Set(rows.filter((r) => r.metric === 'request').map((r) => r.user_id));
  const appMix = {};
  for (const c of connections) appMix[c.app || 'Unknown'] = (appMix[c.app || 'Unknown'] || 0) + 1;

  return {
    people: peopleList,
    daily: Object.entries(series).map(([day, t]) => ({ day, ...t })),
    hours,
    tools: toolTable(rows),
    adoption: {
      activeToday: peopleList.filter((p) => p.today.requests > 0).length,
      active7: activeWithin(7 * DAY_MS),
      active30: activeWithin(30 * DAY_MS),
      newThisWeek: people.filter((p) => p.first_seen && now - p.first_seen < 7 * DAY_MS).length,
      neverUsed: connections.filter((c) => !usedConnections.has(c.id) && now - Date.parse(c.createdAt) > DAY_MS).length,
      idle30: connections.filter((c) => now - Date.parse(c.lastUsedAt) > 30 * DAY_MS).length,
      expiring14: connections.filter((c) => Date.parse(c.expiresAt) - now < 14 * DAY_MS).length,
      appMix,
    },
  };
}

/** Rows for one person as CSV (day, metric, count). */
export function personCsv(rows) {
  const lines = ['day,metric,count'];
  for (const r of [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.metric.localeCompare(b.metric))) {
    lines.push(`${r.day},${/[,"]/.test(r.metric) ? `"${r.metric.replace(/"/g, '""')}"` : r.metric},${r.count}`);
  }
  return lines.join('\n') + '\n';
}

/** Alerts worth an admin's attention, from insights and (optionally) cloud usage. */
export function buildAlerts({ insights, cloud, failedAdminSignInsToday = 0 }) {
  const alerts = [];
  const today = insights.daily[insights.daily.length - 1] || emptyTotals();
  if (today.toolCalls >= 20 && today.errors / today.toolCalls > 0.05) {
    alerts.push({ level: 'warn', text: `${today.errors} tool errors today (${Math.round((today.errors / today.toolCalls) * 100)}% of calls).` });
  }
  if (today.throttled > 0) alerts.push({ level: 'warn', text: `Microsoft slowed down requests ${today.throttled} time(s) today.` });
  for (const p of insights.people) {
    if (p.capUsedToday >= 80) alerts.push({ level: p.capUsedToday >= 100 ? 'bad' : 'warn', text: `${p.name || 'A person'} used ${p.capUsedToday}% of their daily change limit.` });
  }
  if (failedAdminSignInsToday >= 3) alerts.push({ level: 'bad', text: `${failedAdminSignInsToday} failed admin sign-ins today.` });
  for (const l of cloud?.limits || []) {
    if (l.percent >= 80) alerts.push({ level: l.percent >= 100 ? 'bad' : 'warn', text: `${l.label}: ${l.percent}% of the free plan's daily limit.` });
  }
  return alerts;
}
