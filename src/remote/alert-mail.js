// Alert emails to the admin, sent with Cloudflare's send_email binding.
//
// Free on every plan when the recipient is a verified Email Routing destination address. Set up:
//   1. Cloudflare dashboard → Email Routing: turn it on for your domain and add the admin's address as a
//      destination (Cloudflare emails a link to verify it).
//   2. wrangler.toml: [[send_email]] name = "ALERT_EMAIL", destination_address = "<that address>", and the vars
//      ALERT_EMAIL_FROM (an address on the Email Routing domain), ALERT_EMAIL_TO (the same destination),
//      optionally PUBLIC_URL (for the admin link) and ALERT_TIMEZONE (e.g. Asia/Kolkata).
//
// Two kinds, each switchable in Admin → Settings: free-plan limit warnings (checked hourly; one email when a limit
// passes 80% and one when it reaches 100%, at most once a day each) and a daily usage summary.
import { cloudUsage } from './cloud.js';

const NAME = 'Teams Personal MCP';
const STATE_KEY = 'mail_limit_state';
const COLORS = { bad: '#9c2618', warn: '#b07a00', ok: '#1b6643', info: '#284a80' };
const BADGE = { bad: ['#fbe1dc', '#9c2618'], warn: ['#fcefd2', '#7c5200'], ok: ['#def1e6', '#1b6643'], info: ['#e3ebf7', '#284a80'] };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export const mailConfigured = (env) => Boolean(env.ALERT_EMAIL && env.ALERT_EMAIL_FROM && env.ALERT_EMAIL_TO);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => Number(n || 0).toLocaleString('en-US');
const size = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);
const amount = (l) => (/storage/i.test(l.label) ? `${size(l.used)} of ${size(l.limit)}` : `${num(l.used)} of ${num(l.limit)}`);
const levelOf = (p) => (p >= 100 ? 'bad' : p >= 80 ? 'warn' : 'ok');

export function formatWhen(ms, tz = 'UTC') {
  try {
    return `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)} ${tz === 'UTC' ? 'UTC' : `(${tz})`}`;
  } catch {
    return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}

/**
 * Builds { subject, html, text } for one email. All values are escaped; nothing is trusted.
 * @param m { subject, preheader, badge: [label, level], title, intro, stats: [[label, value, note?]], alerts: [{ level, text, link }],
 *            limits: [{ label, used, limit, percent }], limitsTitle, adminUrl, adminLink, to, when }
 */
export function renderAlertEmail(m) {
  const link = (hash) => (m.adminUrl ? `${m.adminUrl}/admin${hash || ''}` : null);
  const p = (text, style = '') => `<p style="margin:0 0 16px;font:400 15px/1.55 ${FONT};color:#554c44;${style}">${text}</p>`;
  const h2 = (text) => `<h2 style="margin:28px 0 12px;font:600 16px/1.3 ${FONT};color:#1d1916;letter-spacing:-0.01em;">${esc(text)}</h2>`;

  const stats = m.stats?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;margin:8px 0 4px;background:#f6f3ef;border-radius:10px;">
    <tr>${m.stats.map(([label, value, note], i) => `<td valign="top" style="padding:14px 16px;${i ? 'border-left:1px solid #e3dcd3;' : ''}width:${Math.floor(100 / m.stats.length)}%;">
      <div style="font:600 22px/1.15 ${FONT};color:#1d1916;letter-spacing:-0.02em;">${esc(value)}</div>
      <div style="font:400 13px/1.4 ${FONT};color:#554c44;margin-top:4px;">${esc(label)}</div>
      ${note ? `<div style="font:600 12px/1.4 ${FONT};color:#6f665d;margin-top:2px;">${esc(note)}</div>` : ''}</td>`).join('')}</tr></table>` : '';

  const alerts = m.alerts?.length ? `${h2(m.alertsTitle || 'Needs your attention')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${m.alerts.map((a) => {
      const href = a.link && link(a.link);
      return `<tr><td valign="top" width="18" style="padding:12px 0 12px 2px;"><div style="width:9px;height:9px;border-radius:50%;background:${COLORS[a.level] || COLORS.warn};margin-top:6px;"></div></td>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe5;font:500 14px/1.5 ${FONT};color:#1d1916;">${esc(a.text)}${href ? ` <a href="${esc(href)}" style="color:#b2361f;font-weight:600;text-decoration:underline;white-space:nowrap;">Open</a>` : ''}</td></tr>`;
    }).join('')}</table>` : '';

  const limits = m.limits?.length ? `${h2(m.limitsTitle || 'Cloudflare free plan')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${m.limits.map((l) => {
      const pc = Math.max(0, Math.min(100, l.percent));
      const color = COLORS[levelOf(l.percent)] === COLORS.ok ? '#1d1916' : COLORS[levelOf(l.percent)];
      return `<tr><td style="padding:8px 0 4px;font:500 14px/1.4 ${FONT};color:#1d1916;">${esc(l.label)}</td>
        <td align="right" style="padding:8px 0 4px;font:400 13px/1.4 ${FONT};color:#554c44;white-space:nowrap;">${esc(amount(l))} <b style="color:${color};">${esc(l.percent)}%</b></td></tr>
        <tr><td colspan="2" style="padding:0 0 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe5;border-radius:4px;"><tr>
          <td width="${Math.max(1, Math.round(pc))}%" style="height:8px;line-height:8px;font-size:0;background:${color};border-radius:4px;">&nbsp;</td>${pc < 100 ? '<td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>' : ''}
        </tr></table></td></tr>`;
    }).join('')}</table>
    ${p('Limits reset every day at 00:00 UTC, except database storage. Past a limit, Cloudflare refuses requests until the reset; nothing is charged on the free plan.', 'font-size:13px;margin-top:6px;')}` : '';

  const button = link(m.adminLink) ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;"><tr><td style="border-radius:8px;background:#cf4329;">
      <a href="${esc(link(m.adminLink))}" style="display:inline-block;padding:12px 22px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${esc(m.button || 'Open the admin page')}</a></td></tr></table>` : '';

  const [badgeLabel, badgeLevel] = m.badge || ['Alert', 'warn'];
  const [badgeBg, badgeInk] = BADGE[badgeLevel] || BADGE.info;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f3ef;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(m.preheader || m.intro || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ef;"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
    <tr><td style="padding:0 6px 14px;font:600 14px/1.4 ${FONT};color:#1d1916;letter-spacing:-0.01em;">${NAME} <span style="font-weight:400;color:#6f665d;">&middot; Admin alerts</span></td></tr>
    <tr><td style="background:#ffffff;border-radius:14px;padding:30px 30px 26px;box-shadow:0 1px 2px rgba(31,26,23,.06);">
      <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${badgeBg};color:${badgeInk};font:600 12px/1.2 ${FONT};">${esc(badgeLabel)}</span>
      <h1 style="margin:14px 0 10px;font:600 24px/1.2 ${FONT};color:#1d1916;letter-spacing:-0.025em;">${esc(m.title)}</h1>
      ${m.intro ? p(esc(m.intro)) : ''}
      ${stats}${alerts}${limits}${button}
    </td></tr>
    <tr><td style="padding:18px 6px 0;font:400 12px/1.6 ${FONT};color:#6f665d;">
      ${esc(m.when || '')}<br>
      Sent to ${esc(m.to || 'the admin')} because email alerts are on. Change them in Admin &rarr; Settings &rarr; Email alerts.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const lines = [m.title, ''];
  if (m.intro) lines.push(m.intro, '');
  if (m.stats?.length) { for (const [label, value, note] of m.stats) lines.push(`${label}: ${value}${note ? ` (${note})` : ''}`); lines.push(''); }
  if (m.alerts?.length) { lines.push(`${m.alertsTitle || 'Needs your attention'}:`); for (const a of m.alerts) lines.push(`- ${a.text}${a.link && link(a.link) ? ` ${link(a.link)}` : ''}`); lines.push(''); }
  if (m.limits?.length) { lines.push(`${m.limitsTitle || 'Cloudflare free plan'}:`); for (const l of m.limits) lines.push(`- ${l.label}: ${amount(l)} (${l.percent}%)`); lines.push('', 'Limits reset every day at 00:00 UTC, except database storage.', ''); }
  if (link(m.adminLink)) lines.push(`${m.button || 'Open the admin page'}: ${link(m.adminLink)}`, '');
  lines.push('--', m.when || '', `Sent to ${m.to || 'the admin'} because email alerts are on. Change them in Admin > Settings > Email alerts.`);
  return { subject: m.subject, html, text: lines.join('\n') };
}

async function send(env, msg) {
  try {
    const r = await env.ALERT_EMAIL.send({
      from: { email: env.ALERT_EMAIL_FROM, name: NAME },
      to: env.ALERT_EMAIL_TO,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { ok: true, messageId: r?.messageId || null };
  } catch (e) {
    const why = String(e?.message || e);
    const hint = /verif/i.test(why) || /RECIPIENT/i.test(e?.code || '')
      ? ` Check that ${env.ALERT_EMAIL_TO} is verified under Email Routing → Destination addresses.`
      : /SENDER|DOMAIN/i.test(e?.code || why) ? ' Check that Email Routing is turned on for the sender\'s domain.' : '';
    return { ok: false, error: `${why.slice(0, 200)}${hint}` };
  }
}

const base = (env, now) => ({ to: env.ALERT_EMAIL_TO, adminUrl: env.PUBLIC_URL ? String(env.PUBLIC_URL).replace(/\/+$/, '') : null, when: formatWhen(now, env.ALERT_TIMEZONE || 'UTC') });

export async function sendTestEmail(env, now = Date.now()) {
  if (!mailConfigured(env)) return { ok: false, error: 'Email alerts are not set up on this server.' };
  return send(env, renderAlertEmail({
    ...base(env, now),
    subject: `${NAME}: test email`,
    badge: ['Test', 'info'],
    title: 'Email alerts work',
    intro: 'This is a test from the admin page. Free-plan limit warnings and the daily usage summary will arrive at this address.',
    adminLink: '#settings',
  }));
}

/** Hourly: emails once when a free-plan limit passes 80% and once when it reaches 100% (per limit, per UTC day). */
export async function checkLimits(env, { enabled = true, now = Date.now() } = {}) {
  if (!enabled || !mailConfigured(env)) return { sent: false };
  const cloud = await cloudUsage(env, now).catch(() => null);
  if (!cloud?.configured || cloud.error) return { sent: false };
  const day = new Date(now).toISOString().slice(0, 10);
  const raw = (await env.DB.prepare('SELECT value FROM access_settings WHERE key = ?').bind(STATE_KEY).first())?.value;
  let state = raw ? JSON.parse(raw) : {};
  if (state.day !== day) state = { day, sent: [] };
  const crossed = cloud.limits.filter((l) => l.percent >= 80).map((l) => ({ ...l, level: l.percent >= 100 ? 'bad' : 'warn', key: `${l.label}|${l.percent >= 100 ? 100 : 80}` }));
  const fresh = crossed.filter((l) => !state.sent.includes(l.key));
  if (!fresh.length) return { sent: false };
  const worst = fresh.some((l) => l.level === 'bad');
  const first = fresh[0];
  const msg = renderAlertEmail({
    ...base(env, now),
    subject: worst
      ? `${NAME}: free plan limit reached (${first.label.toLowerCase()})`
      : `${NAME}: ${first.label.toLowerCase()} at ${first.percent}% of the free plan`,
    preheader: fresh.map((l) => `${l.label}: ${l.percent}%`).join(', '),
    badge: worst ? ['Limit reached', 'bad'] : ['Approaching the limit', 'warn'],
    title: worst ? 'A free-plan limit has been reached' : 'Usage is close to a free-plan limit',
    intro: worst
      ? 'Cloudflare refuses requests past this limit until it resets at 00:00 UTC, so people may see errors until then.'
      : 'Nothing is refused yet. You will get one more email if it reaches 100% today.',
    alerts: fresh.map((l) => ({ level: l.level, text: `${l.label}: ${amount(l)} (${l.percent}%)`, link: '#usage' })),
    alertsTitle: 'What crossed the line',
    limits: cloud.limits,
    limitsTitle: 'All free-plan limits now',
    adminLink: '#usage',
    button: 'See usage',
  });
  const r = await send(env, msg);
  if (r.ok) {
    state.sent.push(...fresh.map((l) => l.key));
    await env.DB.prepare('INSERT INTO access_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(STATE_KEY, JSON.stringify(state)).run();
  }
  return { sent: r.ok, error: r.error };
}

/** Nightly: yesterday's usage, today's open alerts and the free-plan meters. `overview` is the admin overview. */
export async function sendDailySummary(env, overview, { enabled = true, now = Date.now() } = {}) {
  if (!enabled || !mailConfigured(env)) return { sent: false };
  const y = overview.daily[overview.daily.length - 2] || { requests: 0, toolCalls: 0, changes: 0, errors: 0 };
  const before = overview.daily[overview.daily.length - 3];
  const change = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}% vs day before` : null);
  const label = y.day ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${y.day}T00:00:00Z`)) : 'yesterday';
  const cloud = overview.cloud?.configured && !overview.cloud.error ? overview.cloud : null;
  const yCloud = cloud?.days?.find((d) => d.day === y.day);
  const alerts = overview.alerts || [];
  const bad = alerts.some((a) => a.level === 'bad');
  return send(env, renderAlertEmail({
    ...base(env, now),
    subject: `${NAME}: ${label} usage, ${num(y.requests)} requests${alerts.length ? `, ${alerts.length} alert${alerts.length === 1 ? '' : 's'}` : ''}`,
    preheader: `${num(y.toolCalls)} tool calls, ${num(overview.adoption?.activeToday ?? 0)} people active today, ${alerts.length ? `${alerts.length} alerts` : 'no alerts'}.`,
    badge: alerts.length ? [bad ? 'Action needed' : `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`, bad ? 'bad' : 'warn'] : ['All clear', 'ok'],
    title: `Daily usage for ${label}`,
    intro: `${num(overview.totals.people)} people use the server; ${num(overview.adoption?.active7 ?? 0)} were active in the last 7 days.`,
    stats: [
      ['Requests', num(y.requests), change(y.requests, before?.requests)],
      ['Tool calls', num(y.toolCalls), change(y.toolCalls, before?.toolCalls)],
      ['Changes to Teams', num(y.changes)],
      ['Tool errors', num(y.errors)],
    ],
    alerts,
    limits: cloud ? cloud.limits.map((l) => (yCloud && /today/.test(l.label)
      ? { ...l, label: l.label.replace('today', `on ${label}`), used: l.label.startsWith('Requests') ? yCloud.requests : /read/.test(l.label) ? yCloud.rowsRead : yCloud.rowsWritten }
      : l)).map((l) => ({ ...l, percent: Math.round((l.used / l.limit) * 1000) / 10 })) : null,
    limitsTitle: cloud ? `Cloudflare free plan (month so far: ${num(cloud.month.requests)} requests, $${cloud.costNow.toFixed(2)})` : null,
    adminLink: alerts.length ? '#overview' : '#usage',
  }));
}
