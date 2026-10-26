// Issue events and the root-cause report behind the admin page's Issues view.
// Every event says what happened, to whom, in which tool, and a short detail scrubbed of chat ids, person ids,
// links and emails. Message text is never recorded.

const DAY_MS = 24 * 60 * 60 * 1000;
export const KEEP_DAYS = 14;
const MAX_EVENTS_PER_REQUEST = 10;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** What each kind of issue means and what to do about it (shown on the admin page). */
export const ISSUE_KINDS = {
  throttled: {
    label: 'Microsoft slow-downs',
    means: 'Microsoft asked the server to wait before calling Teams again for this account (HTTP 429/503).',
    action: 'Short waits are retried automatically. If one person causes most of them, it usually comes from tools that read many chats at once (search, mentions, unread): searching within one chat is lighter.',
  },
  tool_error: {
    label: 'Tool errors',
    means: 'A tool call failed and the assistant got an error instead of a result.',
    action: 'Read the details: deleted or unshared files, chats the person left and Teams outages are expected; anything repeating across people needs a look.',
  },
  refused: {
    label: 'Calls refused by limits',
    means: 'A per-person limit stopped a call (requests, searches or changes per minute, or the daily change cap).',
    action: 'If a person hits the daily change cap for good reason, raise it on their page under People.',
  },
  signin_refused: {
    label: 'Refused sign-ins',
    means: 'Someone signed in at Microsoft but was not allowed in. Nothing of theirs was stored.',
    action: 'Approve or block them under Access, or add their Teams group.',
  },
  access_denied: {
    label: 'Connections cut off',
    means: 'A connection was stopped because the account lost access (left an access group, was blocked or removed).',
    action: 'Check the person under Access if this was not intended.',
  },
  admin_signin_failed: {
    label: 'Failed admin sign-ins',
    means: 'Someone entered a wrong admin username or password.',
    action: 'If it was not you, change ADMIN_PASSWORD in Cloudflare: that also signs out every admin session.',
  },
};

/** Removes anything that identifies a chat, person, link or email from a short detail text. */
export function scrub(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '{link}')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '{email}')
    .replace(/\b19:[^\s"'),]+/g, '{chat}')
    .replace(/\b(8|28|48):[^\s"'),]+/g, '{person}')
    .replace(/\b(tpm|inv|code|req|login)_[A-Za-z0-9_-]{8,}/g, '{key}')
    .replace(/\b\d{9,}\b/g, '{id}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** D1 statements for events gathered during one request (at most 10). */
export function eventStatements(env, events, { userId = null, accountHash = null, now = Date.now() } = {}) {
  return events.slice(0, MAX_EVENTS_PER_REQUEST).map((e) => env.DB.prepare(
    'INSERT INTO diag_events (at, day, kind, account_hash, user_id, tool, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(e.at || now, dayOf(e.at || now), e.kind, e.accountHash ?? accountHash, userId, e.tool || null, scrub(e.detail)));
}

/** Records one event right away (sign-ins, admin sign-ins). Never fails the caller. */
export function recordEvent(env, ctx, event) {
  const p = Promise.all(eventStatements(env, [event]).map((s) => s.run())).catch(() => {});
  ctx?.waitUntil?.(p);
  return p;
}

export const cleanupStatement = (env, now = Date.now()) =>
  env.DB.prepare('DELETE FROM diag_events WHERE at < ?').bind(now - KEEP_DAYS * DAY_MS);

const top = (items, n = 3) => {
  const counts = new Map();
  for (const x of items) if (x) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
};

/** Issues per day for the last 14 days (the overview's health strip) and today's total. */
export async function issueDays(env, now = Date.now()) {
  const rows = (await env.DB.prepare('SELECT day, kind, COUNT(*) AS n FROM diag_events WHERE at >= ? GROUP BY day, kind').bind(now - KEEP_DAYS * DAY_MS).all()).results || [];
  const days = Array.from({ length: KEEP_DAYS }, (_, i) => dayOf(now - (KEEP_DAYS - 1 - i) * DAY_MS)).map((d) => {
    const counts = Object.fromEntries(Object.keys(ISSUE_KINDS).map((k) => [k, 0]));
    for (const r of rows) if (r.day === d && counts[r.kind] !== undefined) counts[r.kind] += r.n;
    return { day: d, total: Object.values(counts).reduce((a, b) => a + b, 0), counts };
  });
  return { days, today: days[days.length - 1].total };
}

/**
 * The Issues view: a day-by-day strip, a root-cause summary per kind, and the matching events.
 * Filters: kind, key (account hash), tool, day.
 */
export async function issuesReport(env, { kind = null, key = null, tool = null, day = null, now = Date.now() } = {}) {
  const since = now - KEEP_DAYS * DAY_MS;
  const rows = (await env.DB.prepare('SELECT at, day, kind, account_hash, user_id, tool, detail FROM diag_events WHERE at >= ? ORDER BY at DESC LIMIT 5000').bind(since).all()).results || [];
  const people = new Map(((await env.DB.prepare('SELECT account_hash, name FROM people').all()).results || []).map((p) => [p.account_hash, p.name]));
  const nameOf = (hash) => (hash ? people.get(hash) || 'Unknown person' : null);

  const days = Array.from({ length: KEEP_DAYS }, (_, i) => dayOf(now - (KEEP_DAYS - 1 - i) * DAY_MS));
  const strip = days.map((d) => {
    const counts = Object.fromEntries(Object.keys(ISSUE_KINDS).map((k) => [k, 0]));
    for (const r of rows) if (r.day === d && counts[r.kind] !== undefined) counts[r.kind]++;
    return { day: d, total: Object.values(counts).reduce((a, b) => a + b, 0), counts };
  });

  const scoped = rows.filter((r) => (!key || r.account_hash === key) && (!tool || r.tool === tool) && (!day || r.day === day));
  const summary = Object.entries(ISSUE_KINDS).map(([k, meta]) => {
    const list = scoped.filter((r) => r.kind === k);
    if (!list.length) return null;
    const byPerson = top(list.map((r) => r.account_hash)).map((x) => ({ key: x.value, name: nameOf(x.value), count: x.count }));
    const byTool = top(list.map((r) => r.tool));
    const byDetail = top(list.map((r) => (k === 'throttled' ? r.detail?.split(' · ')[0] : r.detail)), 3);
    const lead = byPerson[0]?.key && people.has(byPerson[0].key) ? `${Math.round((byPerson[0].count / list.length) * 100)}% from ${byPerson[0].name}` : null;
    const leadTool = byTool[0] ? `mostly ${byTool[0].value.replace(/^teams_/, '')}` : null;
    return {
      kind: k, ...meta, count: list.length, today: list.filter((r) => r.day === dayOf(now)).length,
      cause: [lead, leadTool].filter(Boolean).join(', ') || null,
      people: byPerson, tools: byTool, details: byDetail,
      lastAt: new Date(list[0].at).toISOString(),
    };
  }).filter(Boolean);

  const events = scoped.filter((r) => !kind || r.kind === kind).slice(0, 300).map((r) => ({
    at: new Date(r.at).toISOString(), kind: r.kind, label: ISSUE_KINDS[r.kind]?.label || r.kind,
    key: r.account_hash, person: nameOf(r.account_hash), tool: r.tool, detail: r.detail,
  }));

  return { days: strip, summary, events, filters: { kind, key, tool, day }, keepDays: KEEP_DAYS, kinds: ISSUE_KINDS };
}
