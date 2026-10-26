import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { scrub, eventStatements, issuesReport, issueDays } from '../src/remote/diagnostics.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.13 */ }
const t = DatabaseSync ? test : test.skip;

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  const prepare = (sql) => {
    const st = {
      args: [],
      bind(...a) { st.args = a; return st; },
      async run() { const r = db.prepare(sql).run(...st.args); return { meta: { changes: Number(r.changes) } }; },
      async first() { return db.prepare(sql).get(...st.args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...st.args) }; },
    };
    return st;
  };
  return { prepare, batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

test('details never keep chat ids, person ids, links, emails or keys', () => {
  const out = scrub('Teams API GET /users/ME/conversations/19:abc123@thread.v2/messages failed (403) for 8:live:.cid.42 see https://teams.live.com/x mail a.b@example.com key tpm_ABCDEFGHIJKLMNOP 1792659801430');
  assert.doesNotMatch(out, /19:abc|8:live|https:|example\.com|tpm_ABC|1792659801430/);
  assert.match(out, /\{chat\}.*\{person\}.*\{link\}.*\{email\}.*\{key\}.*\{id\}/);
  assert.ok(scrub('x'.repeat(1000)).length <= 240);
});

t('the issues report names the main cause and filters by kind, person, tool and day', async () => {
  const env = { DB: d1() };
  const now = Date.parse('2026-10-26T12:00:00Z');
  const VISH = 'a'.repeat(64), ASHA = 'b'.repeat(64);
  await env.DB.prepare('INSERT INTO people (account_hash, name, first_seen, last_seen) VALUES (?, ?, 1, 1), (?, ?, 1, 1)').bind(VISH, 'Vish C', ASHA, 'Asha R').run();
  const events = [
    ...Array.from({ length: 9 }, () => ({ kind: 'throttled', accountHash: VISH, tool: 'teams_search_messages', detail: 'teams /users/ME/conversations/{id}/messages · HTTP 429 · asked to wait 2s · retried automatically', at: now - 3600e3 })),
    { kind: 'throttled', accountHash: ASHA, tool: 'teams_get_unread', detail: 'teams /users/ME/conversations · HTTP 429 · asked to wait 30s · gave up', at: now - 2 * 86400e3 },
    { kind: 'tool_error', accountHash: ASHA, tool: 'teams_read_file', detail: 'You no longer have access to this file: it may have been deleted, moved or unshared.', at: now - 600e3 },
  ];
  await env.DB.batch(eventStatements(env, events.slice(0, 10)));
  await env.DB.batch(eventStatements(env, events.slice(10)));

  const all = await issuesReport(env, { now });
  const throttled = all.summary.find((s) => s.kind === 'throttled');
  assert.equal(throttled.count, 10);
  assert.equal(throttled.today, 9);
  assert.equal(throttled.cause, '90% from Vish C, mostly search_messages');
  assert.equal(throttled.details[0].value, 'teams /users/ME/conversations/{id}/messages');
  assert.match(throttled.action, /retried automatically/);
  assert.equal(all.days.length, 14);
  assert.equal(all.days.at(-1).total, 10);

  const asha = await issuesReport(env, { key: ASHA, now });
  assert.deepEqual(asha.events.map((e) => e.tool).sort(), ['teams_get_unread', 'teams_read_file']);
  assert.equal((await issuesReport(env, { kind: 'tool_error', now })).events.length, 1);
  assert.equal((await issuesReport(env, { tool: 'teams_search_messages', now })).events.length, 9);
  assert.equal((await issuesReport(env, { day: '2026-10-24', now })).events.length, 1);

  const strip = await issueDays(env, now);
  assert.equal(strip.today, 10);
  assert.equal(strip.days.at(-3).counts.throttled, 1);
});
