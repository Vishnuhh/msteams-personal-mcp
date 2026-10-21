// Per-person usage counting, insights, alerts, CSV and the cloud cost estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageRecorder, buildInsights, buildAlerts, personCsv } from '../src/remote/usage.js';
import { estimatePaidMonthly } from '../src/remote/cloud.js';
import { registerTeamsTools } from '../src/core/tools.js';

const NOW = Date.parse('2026-10-21T10:30:00Z');
const D = (offset) => new Date(NOW - offset * 86400e3).toISOString().slice(0, 10);

test('recorder counts requests, hours, tools, changes and searches (refused calls are not changes)', () => {
  const r = usageRecorder({ userId: 'u1', accountHash: 'acc1', now: NOW });
  r.tool('teams_send_message', 'write', { ms: 120, bytes: 3000, isError: false, refused: false });
  r.tool('teams_send_message', 'write', { ms: 5, bytes: 100, isError: true, refused: true });
  r.tool('teams_search_messages', 'heavy', { ms: 900, bytes: 20480, isError: false, refused: false });
  r.add('teams_call', 3);
  const m = Object.fromEntries(r.entries());
  assert.equal(m.request, 1);
  assert.equal(m['hour:10'], 1);
  assert.equal(m['tool:teams_send_message'], 2);
  assert.equal(m.write, 1, 'refused send is not a change');
  assert.equal(m.rate_limited, 1);
  assert.equal(m['error:teams_send_message'], 1);
  assert.equal(m.heavy, 1);
  assert.equal(m['kb:teams_search_messages'], 20);
  assert.equal(m.teams_call, 3);
});

test('afterCall reports time, size and outcome of each tool call', async () => {
  const handlers = {};
  const seen = [];
  const client = { listChats: async () => [{ id: 'x' }] };
  registerTeamsTools({ registerTool: (n, c, h) => { handlers[n] = h; } }, client, { afterCall: (name, kind, info) => seen.push({ name, kind, ...info }) });
  await handlers.teams_list_chats({});
  assert.equal(seen[0].name, 'teams_list_chats');
  assert.equal(seen[0].kind, 'read');
  assert.ok(seen[0].bytes > 0 && seen[0].ms >= 0 && seen[0].isError === false && seen[0].refused === false);
});

const rows = [
  { day: D(0), user_id: 'c1', account_hash: 'A', metric: 'request', count: 30 },
  { day: D(0), user_id: 'c1', account_hash: 'A', metric: 'tool:teams_get_unread', count: 20 },
  { day: D(0), user_id: 'c1', account_hash: 'A', metric: 'ms:teams_get_unread', count: 4000 },
  { day: D(0), user_id: 'c1', account_hash: 'A', metric: 'kb:teams_get_unread', count: 100 },
  { day: D(0), user_id: 'c1', account_hash: 'A', metric: 'write', count: 170 },
  { day: D(0), user_id: 'c1', account_hash: 'A', metric: 'hour:10', count: 30 },
  { day: D(2), user_id: 'c2', account_hash: 'A', metric: 'request', count: 10 },
  { day: D(1), user_id: 'c3', account_hash: 'B', metric: 'request', count: 10 },
  { day: D(1), user_id: 'c3', account_hash: 'B', metric: 'tool:teams_send_message', count: 4 },
  { day: D(1), user_id: 'c3', account_hash: 'B', metric: 'error:teams_send_message', count: 1 },
  { day: D(3), user_id: 'c9', account_hash: null, metric: 'request', count: 50 },
];
const connections = [
  { id: 'c1', accountHash: 'A', person: 'Asha Rao', app: 'Claude', createdAt: new Date(NOW - 5 * 86400e3).toISOString(), lastUsedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 90 * 86400e3).toISOString() },
  { id: 'c4', accountHash: 'B', person: null, app: 'Cursor', createdAt: new Date(NOW - 40 * 86400e3).toISOString(), lastUsedAt: new Date(NOW - 35 * 86400e3).toISOString(), expiresAt: new Date(NOW + 5 * 86400e3).toISOString() },
];
const people = [{ account_hash: 'B', name: 'Ravi Kumar', first_seen: NOW - 2 * 86400e3, last_seen: NOW }];

test('insights: people grouped by account across connections, with share, top tool and cap use', () => {
  const ins = buildInsights({ rows, connections, people, now: NOW, overrides: { A: 200 } });
  const a = ins.people.find((p) => p.key === 'A');
  const b = ins.people.find((p) => p.key === 'B');
  const unknown = ins.people.find((p) => p.key === 'conn:c9');
  assert.equal(a.name, 'Asha Rao');
  assert.equal(a.totals.requests, 40, 'two connections of the same account add up');
  assert.equal(a.share, 40, '40 of 100 requests');
  assert.equal(a.topTool, 'teams_get_unread');
  assert.equal(a.capUsedToday, 85);
  assert.equal(b.name, 'Ravi Kumar', 'name from the people table');
  assert.equal(b.totals.errors, 1);
  assert.ok(unknown, 'usage without an account is kept per connection');
  assert.equal(ins.people[0].key, 'conn:c9', 'sorted by requests');
  assert.equal(ins.daily.length, 30);
  assert.equal(ins.daily[29].requests, 30);
  assert.equal(ins.hours[10], 30);
  const unread = ins.tools.find((t) => t.name === 'teams_get_unread');
  assert.deepEqual([unread.calls, unread.avgMs, unread.avgKb, unread.people], [20, 200, 5, 1]);
  assert.equal(ins.tools.find((t) => t.name === 'teams_send_message').errorRate, 25);
  assert.equal(ins.adoption.idle30, 1);
  assert.equal(ins.adoption.expiring14, 1);
  assert.equal(ins.adoption.newThisWeek, 1);
  assert.equal(ins.adoption.neverUsed, 1, 'c4 has no requests');
  assert.deepEqual(ins.adoption.appMix, { Claude: 1, Cursor: 1 });
});

test('alerts: high cap use, throttling, failed admin sign-ins and cloud limits', () => {
  const ins = buildInsights({ rows, connections, people, now: NOW });
  const alerts = buildAlerts({ insights: ins, cloud: { limits: [{ label: 'Requests today', percent: 85 }] }, failedAdminSignInsToday: 4 });
  const texts = alerts.map((a) => a.text).join(' | ');
  assert.match(texts, /Asha Rao used 85% of their daily change limit/);
  assert.match(texts, /4 failed admin sign-ins/);
  assert.match(texts, /Requests today: 85%/);
});

test('CSV export quotes awkward values', () => {
  const csv = personCsv([{ day: '2026-10-21', metric: 'tool:a,b', count: 2 }, { day: '2026-10-20', metric: 'request', count: 1 }]);
  assert.equal(csv, 'day,metric,count\n2026-10-20,request,1\n2026-10-21,"tool:a,b",2\n');
});

test('paid-plan estimate: base price at small usage, overage beyond included amounts', () => {
  assert.equal(estimatePaidMonthly({ requests: 3000, cpuMs: 9000, rowsRead: 50000, rowsWritten: 20000 }).total, 5);
  const big = estimatePaidMonthly({ requests: 20_000_000, rowsWritten: 60_000_000 });
  assert.equal(big.total, 5 + 3 + 10);
});
