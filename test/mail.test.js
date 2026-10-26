// Alert emails: the HTML template, limit warnings (once per level per day) and the daily summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { d1, hasSqlite } from './d1.js';
import { renderAlertEmail, checkLimits, sendDailySummary, sendTestEmail, mailConfigured, formatWhen } from '../src/remote/alert-mail.js';

const t = hasSqlite ? test : test.skip;
const H = 3600e3;

function mailer() {
  const sent = [];
  return { sent, binding: { send: async (m) => { sent.push(m); return { messageId: `m${sent.length}` }; } } };
}
const env = (m, over = {}) => ({
  DB: d1(), ALERT_EMAIL: m.binding, ALERT_EMAIL_FROM: 'alerts@example.com', ALERT_EMAIL_TO: 'admin@example.org',
  PUBLIC_URL: 'https://mcp.example.com/', ALERT_TIMEZONE: 'Asia/Kolkata', CF_ANALYTICS_TOKEN: 'x', CF_ACCOUNT_ID: 'acct', ...over,
});

// Cloudflare analytics answer with `requests` for today.
function analytics(requests, rowsWritten = 0) {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { viewer: { accounts: [{
    workers: [{ sum: { requests, errors: 0, subrequests: 0 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 2000 }, dimensions: { date: day } }],
    d1: [{ sum: { rowsRead: 10, rowsWritten }, dimensions: { date: day } }],
    storage: [{ max: { databaseSizeBytes: 1024 ** 2 }, dimensions: { date: day } }],
  }] } } }));
}
let day = '';
const at = (iso) => { day = iso.slice(0, 10); return Date.parse(iso); };

test('the email is HTML with a plain-text copy, and everything from Teams is escaped', () => {
  const m = renderAlertEmail({
    subject: 'S', title: 'Daily usage', intro: 'Hi', to: 'admin@example.org', adminUrl: 'https://mcp.example.com', adminLink: '#usage',
    stats: [['Requests', '1,200', '+5% vs day before']],
    alerts: [{ level: 'bad', text: '<script>alert(1)</script> used 100% of their daily change limit.', link: '#person/abc' }],
    limits: [{ label: 'Requests today', used: 85_000, limit: 100_000, percent: 85 }, { label: 'Database storage', used: 2 * 1024 ** 3, limit: 5 * 1024 ** 3, percent: 40 }],
  });
  assert.match(m.html, /^<!doctype html>/);
  assert.match(m.html, /role="presentation"/);
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /&lt;script&gt;/);
  assert.match(m.html, /href="https:\/\/mcp\.example\.com\/admin#person\/abc"/);
  assert.match(m.html, /85,000 of 100,000/);
  assert.match(m.html, /2\.00 GB of 5\.00 GB/);
  assert.match(m.text, /Requests today: 85,000 of 100,000 \(85%\)/);
  assert.match(m.text, /https:\/\/mcp\.example\.com\/admin#usage/);
  assert.match(formatWhen(Date.parse('2026-10-26T03:17:00Z'), 'Asia/Kolkata'), /26 Oct 2026.*08:47.*Asia\/Kolkata/);
});

test('alert emails need the binding and both addresses', () => {
  assert.equal(mailConfigured({ ALERT_EMAIL: {}, ALERT_EMAIL_FROM: 'a@x.com', ALERT_EMAIL_TO: 'b@y.com' }), true);
  assert.equal(mailConfigured({ ALERT_EMAIL_FROM: 'a@x.com', ALERT_EMAIL_TO: 'b@y.com' }), false);
});

t('limit warnings: one email at 80%, one at 100%, nothing more that day; again the next day', async () => {
  const m = mailer();
  const e = env(m);
  analytics(50_000);
  assert.equal((await checkLimits(e, { now: at('2026-10-26T01:07:00Z') })).sent, false, 'under 80%');
  analytics(85_000);
  assert.equal((await checkLimits(e, { now: at('2026-10-26T02:07:00Z') })).sent, true);
  assert.match(m.sent[0].subject, /requests today at 85% of the free plan/);
  assert.equal(m.sent[0].to, 'admin@example.org');
  assert.deepEqual(m.sent[0].from, { email: 'alerts@example.com', name: 'Teams Personal MCP' });
  assert.ok(m.sent[0].html && m.sent[0].text);
  analytics(90_000);
  assert.equal((await checkLimits(e, { now: at('2026-10-26T03:07:00Z') })).sent, false, 'already warned at 80%');
  analytics(100_500);
  assert.equal((await checkLimits(e, { now: at('2026-10-26T04:07:00Z') })).sent, true);
  assert.match(m.sent[1].subject, /free plan limit reached/);
  analytics(110_000);
  assert.equal((await checkLimits(e, { now: at('2026-10-26T05:07:00Z') })).sent, false);
  analytics(85_000);
  assert.equal((await checkLimits(e, { now: at('2026-10-27T05:07:00Z') })).sent, true, 'a new day');
  assert.equal((await checkLimits(e, { enabled: false, now: at('2026-10-28T05:07:00Z') })).sent, false, 'switched off');
});

t('a failed send is reported with a hint and does not mark the limit as warned', async () => {
  const e = env({ binding: { send: async () => { throw Object.assign(new Error('destination address not verified'), { code: 'E_RECIPIENT_NOT_ALLOWED' }); } } });
  analytics(95_000);
  const r = await checkLimits(e, { now: at('2026-11-02T02:07:00Z') });
  assert.equal(r.sent, false);
  assert.match(r.error, /verified under Email Routing/);
  const t2 = await sendTestEmail(e);
  assert.equal(t2.ok, false);
});

test('the daily summary covers the previous day with its change and open alerts', async () => {
  const m = mailer();
  const o = {
    daily: [{ day: '2026-10-24', requests: 100, toolCalls: 200, changes: 3, errors: 1 }, { day: '2026-10-25', requests: 150, toolCalls: 300, changes: 5, errors: 2 }, { day: '2026-10-26', requests: 4, toolCalls: 6, changes: 0, errors: 0 }],
    alerts: [{ level: 'warn', text: '2 people are waiting for an access decision.', link: '#access/requests' }],
    totals: { people: 12 }, adoption: { activeToday: 3, active7: 9 },
    cloud: { configured: true, costNow: 0, month: { requests: 4000 }, days: [{ day: '2026-10-25', requests: 1500, rowsRead: 9000, rowsWritten: 300 }],
      limits: [{ label: 'Requests today', used: 40, limit: 100_000, percent: 0 }, { label: 'Database storage', used: 1024 ** 2, limit: 5 * 1024 ** 3, percent: 0 }] },
  };
  await sendDailySummary(env(m), o, { now: Date.parse('2026-10-26T03:17:00Z') });
  const msg = m.sent[0];
  assert.match(msg.subject, /25 Oct usage, 150 requests, 1 alert/);
  assert.match(msg.html, /\+50% vs day before/);
  assert.match(msg.html, /Requests on 25 Oct/);
  assert.match(msg.html, /1,500 of 100,000/);
  assert.match(msg.html, /waiting for an access decision/);
  assert.equal((await sendDailySummary(env(m), o, { enabled: false })).sent, false);
});
