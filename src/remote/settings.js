// Server settings: Cloudflare variables are the defaults; the admin page can override them (stored in D1).
//
//   setting              variable (default)            admin page key
//   personal URLs        DISABLE_PERSONAL_URLS          personal_urls
//   new-connection notes NEW_CONNECTION_ALERTS          connection_alerts
//   access code          ACCESS_CODE                    access_code (stored as a keyed hash, never readable)
//   daily change cap     200                            daily_cap
//   unused connections   90 days                        inactive_days
//   alert webhook        ALERT_WEBHOOK_URL              alert_webhook
//   allow-list           ALLOWED_ACCOUNTS               (variable only)
import { hmacHex, safeEqual } from './crypto.js';

const DEFAULT_CAP = 200;
const DEFAULT_INACTIVE_DAYS = 90;
const TTL_MS = 30_000;
const cache = new WeakMap(); // env.DB -> { at, value }

const flag = (v) => String(v || '').toLowerCase() === 'true';
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const codeHash = (env, code) => hmacHex(env.KEY_SALT || 'msteams-personal-mcp', `access-code|${String(code).trim()}`);

/** The effective settings: D1 overrides on top of the Cloudflare variables. Cached per isolate for 30 s. */
export async function serverSettings(env) {
  const hit = cache.get(env.DB);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const rows = (await env.DB.prepare("SELECT key, value FROM access_settings WHERE key IN ('personal_urls', 'connection_alerts', 'access_code', 'daily_cap', 'inactive_days', 'alert_webhook')").all().catch(() => ({ results: [] }))).results || [];
  const o = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const has = (k) => Object.prototype.hasOwnProperty.call(o, k);
  const value = {
    personalUrls: has('personal_urls') ? o.personal_urls === '1' : !flag(env.DISABLE_PERSONAL_URLS),
    alerts: has('connection_alerts') ? o.connection_alerts === '1' : String(env.NEW_CONNECTION_ALERTS || '').toLowerCase() !== 'false',
    accessCodeHash: has('access_code') ? o.access_code || null : null,
    accessCodeRequired: has('access_code') ? Boolean(o.access_code) : Boolean(env.ACCESS_CODE),
    accessCodeFrom: has('access_code') ? 'admin' : env.ACCESS_CODE ? 'variable' : null,
    dailyCap: has('daily_cap') ? Number(o.daily_cap) : DEFAULT_CAP,
    inactiveDays: has('inactive_days') ? Number(o.inactive_days) : DEFAULT_INACTIVE_DAYS,
    alertWebhook: has('alert_webhook') ? o.alert_webhook || null : env.ALERT_WEBHOOK_URL || null,
    allowList: String(env.ALLOWED_ACCOUNTS || '').split(/[\s,]+/).filter(Boolean),
  };
  cache.set(env.DB, { at: Date.now(), value });
  return value;
}

export const forgetSettings = (env) => cache.delete(env.DB);

/** True when the access code is off, or `code` matches it. */
export async function accessCodeOk(env, s, code) {
  if (!s.accessCodeRequired) return true;
  if (s.accessCodeHash) return safeEqual(await codeHash(env, code || ''), s.accessCodeHash);
  return safeEqual(String(code || '').trim(), String(env.ACCESS_CODE || ''));
}

/** What the admin page shows (never the access code itself). */
export function settingsView(s) {
  return {
    personalUrls: s.personalUrls, alerts: s.alerts, accessCodeRequired: s.accessCodeRequired, accessCodeFrom: s.accessCodeFrom,
    dailyCap: s.dailyCap, inactiveDays: s.inactiveDays, alertWebhook: s.alertWebhook ? s.alertWebhook.replace(/^(https:\/\/[^/]+).*/, '$1/…') : null,
    allowListSize: s.allowList.length,
  };
}

/**
 * Saves the fields present in the body. Returns { response, changes } where changes lists what was changed
 * (for the audit log; never the access code or the full webhook URL).
 */
export async function updateSettings(request, env) {
  const body = await request.json().catch(() => ({}));
  const set = [];
  const changes = [];
  const fail = (msg) => ({ response: json({ error: msg }, 400), changes: [] });
  if ('personalUrls' in body) { if (typeof body.personalUrls !== 'boolean') return fail('Personal URLs must be on or off.'); set.push(['personal_urls', body.personalUrls ? '1' : '0']); changes.push(`personal URLs ${body.personalUrls ? 'on' : 'off'}`); }
  if ('alerts' in body) { if (typeof body.alerts !== 'boolean') return fail('New-connection notes must be on or off.'); set.push(['connection_alerts', body.alerts ? '1' : '0']); changes.push(`new-connection notes ${body.alerts ? 'on' : 'off'}`); }
  if ('dailyCap' in body) {
    const n = Number(body.dailyCap);
    if (!Number.isInteger(n) || n < 0 || n > 5000) return fail('The daily change cap must be a whole number from 0 to 5000.');
    set.push(['daily_cap', String(n)]); changes.push(`default daily change cap ${n}`);
  }
  if ('inactiveDays' in body) {
    const n = Number(body.inactiveDays);
    if (!Number.isInteger(n) || n < 7 || n > 365) return fail('Unused connections must end after 7 to 365 days.');
    set.push(['inactive_days', String(n)]); changes.push(`connections end after ${n} unused days`);
  }
  if ('alertWebhook' in body) {
    const u = String(body.alertWebhook || '').trim();
    if (u && !/^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(u)) return fail('The alert webhook must be an https:// address.');
    set.push(['alert_webhook', u]); changes.push(u ? 'alert webhook set' : 'alert webhook removed');
  }
  if ('accessCode' in body) {
    const c = body.accessCode === null ? '' : String(body.accessCode || '').trim();
    if (c && (c.length < 6 || c.length > 64)) return fail('The access code must be 6 to 64 characters.');
    set.push(['access_code', c ? await codeHash(env, c) : '']); changes.push(c ? 'access code set' : 'access code removed');
  }
  if (!set.length) return fail('Nothing to change.');
  await env.DB.batch(set.map(([k, v]) => env.DB.prepare('INSERT INTO access_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)));
  forgetSettings(env);
  return { response: json({ ok: true, settings: settingsView(await serverSettings(env)) }), changes };
}

/** Removes an admin-page override so the Cloudflare variable (or the default) applies again. */
export async function resetSetting(env, key) {
  const map = { personalUrls: 'personal_urls', alerts: 'connection_alerts', accessCode: 'access_code', dailyCap: 'daily_cap', inactiveDays: 'inactive_days', alertWebhook: 'alert_webhook' };
  if (!map[key]) return json({ error: 'Unknown setting.' }, 400);
  await env.DB.prepare('DELETE FROM access_settings WHERE key = ?').bind(map[key]).run();
  forgetSettings(env);
  return json({ ok: true, settings: settingsView(await serverSettings(env)) });
}
