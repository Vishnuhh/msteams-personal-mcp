// Admin sign-in, sessions, two-factor, settings, the audit log and the paged admin lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { d1, hasSqlite } from './d1.js';
import {
  adminConfigured, login, adminFrom, logout, listSessions, endSessions, audit, auditLog,
  startTwoFactor, confirmTwoFactor, disableTwoFactor, twoFactorStatus,
} from '../src/remote/admin-auth.js';
import { totpCode, totpStep, newTotpSecret } from '../src/remote/totp.js';
import { serverSettings, updateSettings, resetSetting, accessCodeOk, settingsView } from '../src/remote/settings.js';
import { paging, setPersonMeta, person, setPersonLimit } from '../src/remote/admin.js';
import {
  accessPeople, accessGroups, groupDetail, renameGroup, accessInvites, editInvite, bulkAccess, accessCounts, createInvite,
} from '../src/remote/access.js';
import { renderAdminPage } from '../src/remote/admin-page.js';

const t = hasSqlite ? test : test.skip;
const env = (over = {}) => ({ KEY_SALT: 'salt', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'correct horse battery', ADMIN_TOKEN: 'tok_123', DB: hasSqlite ? d1() : null, ...over });
const post = (body, path = '/admin/login') => new Request(`https://x.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const asCookie = (res) => res.headers.get('Set-Cookie').split(';')[0];
const get = (cookie, path = '/admin/api/overview') => new Request(`https://x.test${path}`, { headers: { Cookie: cookie } });
const RIGHT = { username: 'admin', password: 'correct horse battery' };
const H = (c) => c.repeat(64);

test('admin sign-in needs a username and a password of 12+ characters', () => {
  assert.equal(adminConfigured(env()), true);
  assert.equal(adminConfigured(env({ ADMIN_PASSWORD: 'short' })), false);
  assert.equal(adminConfigured(env({ ADMIN_USERNAME: '' })), false);
});

test('two-factor codes match the RFC 6238 test vectors', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(await totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(await totpCode(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(await totpStep(secret, '081804', 1111111109 * 1000), Math.floor(1111111109 / 30));
  assert.equal(await totpStep(secret, '081804', 1111111109 * 1000 + 120_000), null, 'too old');
  assert.equal(await totpStep(secret, 'abc', 0), null);
  assert.match(newTotpSecret(), /^[A-Z2-7]{32}$/);
});

t('login: wrong credentials are refused and counted; right ones set a strict cookie and a server session', async () => {
  const e = env();
  let fails = 0;
  const bad = await login(post({ username: 'admin', password: 'nope' }), e, { onFail: () => fails++ });
  assert.equal(bad.response.status, 401);
  assert.equal(fails, 1);
  assert.equal(bad.response.headers.get('Set-Cookie'), null);
  const good = await login(post(RIGHT), e, { country: 'IN', agent: 'Test' });
  assert.equal(good.response.status, 200);
  const cookie = good.response.headers.get('Set-Cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/admin']) assert.ok(cookie.includes(flag), flag);
  const token = decodeURIComponent(asCookie(good.response).split('=')[1]);
  assert.ok(!JSON.stringify(e.DB.db.prepare('SELECT * FROM admin_sessions').all()).includes(token), 'only the hash is stored');
  assert.equal((await login(post(RIGHT), env({ ADMIN_PASSWORD: '' }))).response.status, 503);
});

t('sessions: valid until idle for 30 minutes or 8 hours old, ended by sign-out or a password change', async () => {
  const e = env();
  const now = Date.now();
  const c = asCookie((await login(post(RIGHT), e, { now })).response);
  assert.equal((await adminFrom(get(c), e, now + 60_000)).via, 'session');
  const idle = await adminFrom(get(c), e, now + 60_000 + 31 * 60_000);
  assert.equal(idle.ok, false);
  assert.equal(idle.expired, true);

  const c2 = asCookie((await login(post(RIGHT), e, { now })).response);
  for (let at = now + 29 * 60_000; at < now + 8 * 3600e3; at += 29 * 60_000) assert.equal((await adminFrom(get(c2), e, at)).ok, true);
  assert.equal((await adminFrom(get(c2), e, now + 8 * 3600e3 + 1)).ok, false, 'absolute limit');

  const c3 = asCookie((await login(post(RIGHT), e)).response);
  assert.equal((await adminFrom(get(c3), env({ DB: e.DB, ADMIN_PASSWORD: 'a brand new password' }))).ok, false, 'password change');
  const c4 = asCookie((await login(post(RIGHT), e)).response);
  await logout(get(c4, '/admin/logout'), e);
  assert.equal((await adminFrom(get(c4), e)).ok, false, 'signed out on the server');
  assert.equal((await adminFrom(get('tpm_admin=ses_madeupmadeupmadeupmadeup'), e)).ok, false);
});

t('ADMIN_TOKEN is read-only', async () => {
  const e = env();
  const bearer = (method, token = 'tok_123') => new Request('https://x.test/admin/api/settings', { method, headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(await adminFrom(bearer('GET'), e), { ok: true, via: 'token' });
  assert.deepEqual(await adminFrom(bearer('POST'), e), { ok: false, readOnly: true });
  assert.equal((await adminFrom(bearer('GET', 'wrong'), e)).ok, false);
});

t('sessions list and "sign out everywhere else"', async () => {
  const e = env();
  const a = await login(post(RIGHT), e);
  await login(post(RIGHT), e);
  await login(post(RIGHT), e);
  const list = await listSessions(e, a.sessionId);
  assert.equal(list.length, 3);
  assert.equal(list.filter((s) => s.current).length, 1);
  assert.equal((await (await endSessions(e, { allExcept: a.sessionId })).json()).ended, 2);
  assert.equal((await listSessions(e, a.sessionId)).length, 1);
  assert.equal((await endSessions(e, { id: 'nope' })).status, 400);
});

t('two-factor: set-up needs a valid code; sign-in then asks for one and refuses reuse', async () => {
  const e = env();
  const { secret } = await (await startTwoFactor(e)).json();
  assert.deepEqual(await twoFactorStatus(e), { enabled: false, pending: true });
  assert.equal((await confirmTwoFactor(post({ code: '000000' }), e)).status, 400);
  const step = Math.floor(Date.now() / 30_000);
  assert.equal((await confirmTwoFactor(post({ code: await totpCode(secret, step - 1) }), e)).status, 200);
  assert.deepEqual(await twoFactorStatus(e), { enabled: true, pending: false });

  const noCode = await login(post(RIGHT), e);
  assert.equal(noCode.response.status, 401);
  assert.equal((await noCode.response.json()).needCode, true);
  const used = await login(post({ ...RIGHT, code: await totpCode(secret, step - 1) }), e);
  assert.equal(used.ok, undefined, 'a used code is refused');
  const ok = await login(post({ ...RIGHT, code: await totpCode(secret, step) }), e);
  assert.equal(ok.ok, true);
  assert.equal((await disableTwoFactor(post({ code: await totpCode(secret, step + 1) }), e)).status, 200);
  assert.equal((await twoFactorStatus(e)).enabled, false);
});

t('audit log records actions and pages them newest first', async () => {
  const e = env();
  for (let i = 0; i < 25; i++) await audit(e, null, { action: i % 2 ? 'group added' : 'person approved', target: `t${i}` });
  const p1 = await auditLog(e, { page: 1, size: 20 });
  assert.equal(p1.total, 25);
  assert.equal(p1.items.length, 20);
  assert.equal((await auditLog(e, { page: 2, size: 20 })).items.length, 5);
  assert.equal((await auditLog(e, { q: 'group' })).total, 12);
});

t('settings: admin overrides win over variables; the access code is stored only as a hash', async () => {
  const e = env({ ACCESS_CODE: 'from-variable', DISABLE_PERSONAL_URLS: 'true' });
  let s = await serverSettings(e);
  assert.equal(s.personalUrls, false);
  assert.equal(s.dailyCap, 200);
  assert.equal(await accessCodeOk(e, s, 'from-variable'), true);
  assert.equal((await updateSettings(post({ dailyCap: -1 }), e)).response.status, 400);
  assert.equal((await updateSettings(post({ inactiveDays: 3 }), e)).response.status, 400);
  assert.equal((await updateSettings(post({ alertWebhook: 'http://insecure.test/x' }), e)).response.status, 400);
  const r = await updateSettings(post({ personalUrls: true, dailyCap: 50, inactiveDays: 30, accessCode: 'new-code-123', alertWebhook: 'https://hooks.example.com/abc/secret' }), e);
  assert.equal(r.response.status, 200);
  assert.doesNotMatch(r.changes.join(' '), /new-code-123|secret/);
  s = await serverSettings(e);
  assert.equal(s.personalUrls, true);
  assert.equal(s.dailyCap, 50);
  assert.equal(s.inactiveDays, 30);
  assert.equal(await accessCodeOk(e, s, 'new-code-123'), true);
  assert.equal(await accessCodeOk(e, s, 'from-variable'), false);
  assert.doesNotMatch(JSON.stringify(e.DB.db.prepare('SELECT * FROM access_settings').all()), /new-code-123/);
  assert.equal(settingsView(s).alertWebhook, 'https://hooks.example.com/…');
  await resetSetting(e, 'accessCode');
  assert.equal(await accessCodeOk(e, await serverSettings(e), 'from-variable'), true);
  assert.equal((await resetSetting(e, 'nope')).status, 400);
});

test('paging keeps size 1-50 and page from 1', () => {
  assert.deepEqual(paging(new URL('https://x.test/?page=0&size=999&q=%20hi%20')), { page: 1, size: 50, q: 'hi' });
  assert.deepEqual(paging(new URL('https://x.test/')), { page: 1, size: 10, q: '' });
});

function seedPeople(e, n, status = 'pending') {
  for (let i = 0; i < n; i++) {
    const key = i.toString(16).padStart(64, '0');
    e.DB.db.prepare('INSERT INTO access_people (account_hash, status, name, via, attempts, requested_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(key, status, `Person ${i}`, status === 'member' ? 'group:19:g11@thread.v2' : null, i, i);
  }
  return Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, '0'));
}

t('access lists are paged 10 at a time and searchable', async () => {
  const e = env();
  seedPeople(e, 23);
  const p1 = await (await accessPeople(e, { status: 'requests', page: 1, size: 10, q: '' })).json();
  assert.equal(p1.total, 23);
  assert.equal(p1.items.length, 10);
  assert.equal(p1.items[0].name, 'Person 22', 'newest request first');
  assert.equal((await (await accessPeople(e, { status: 'requests', page: 3, size: 10, q: '' })).json()).items.length, 3);
  assert.equal((await (await accessPeople(e, { status: 'requests', page: 1, size: 10, q: 'Person 2' })).json()).total, 4);
  assert.equal((await accessPeople(e, { status: 'nope', page: 1, size: 10 })).status, 400);
  assert.equal((await accessCounts(e, { restricted: true, since: null })).requests, 23);
});

t('bulk approve handles many people in one request and never blocks the admin account', async () => {
  const e = env();
  const keys = seedPeople(e, 12);
  assert.equal((await (await bulkAccess(post({ keys, action: 'approve' }), e, { adminKey: keys[0] })).json()).done, 12);
  const blocked = await (await bulkAccess(post({ keys, action: 'block' }), e, { adminKey: keys[0] })).json();
  assert.equal(blocked.done, 11);
  assert.equal(blocked.failed, 1);
  assert.equal((await bulkAccess(post({ keys: [], action: 'approve' }), e)).status, 400);
  assert.equal((await bulkAccess(post({ keys, action: 'explode' }), e)).status, 400);
});

t('groups: paged, detail lists the members who got in through it, rename', async () => {
  const e = env();
  for (let i = 0; i < 12; i++) e.DB.db.prepare('INSERT INTO access_groups (conversation_id, name, added_at) VALUES (?, ?, ?)').run(`19:g${i}@thread.v2`, `Group ${i}`, i);
  seedPeople(e, 4, 'member');
  const list = await (await accessGroups(e, { page: 1, size: 10, q: '' })).json();
  assert.equal(list.total, 12);
  assert.equal(list.items.length, 10);
  assert.equal(list.items.find((g) => g.id === '19:g11@thread.v2').members, 4);
  const d = await (await groupDetail(e, '19:g11@thread.v2', { page: 1, size: 10, q: '' })).json();
  assert.equal(d.group.members, 4);
  assert.equal(d.items.length, 4);
  assert.equal((await groupDetail(e, '19:none@thread.v2', { page: 1, size: 10 })).status, 404);
  assert.equal((await renameGroup(post({ conversationId: '19:g11@thread.v2', name: '  Squad  ' }), e)).status, 200);
  assert.equal(e.DB.db.prepare("SELECT name FROM access_groups WHERE conversation_id = '19:g11@thread.v2'").get().name, 'Squad');
  assert.equal((await renameGroup(post({ conversationId: '19:g11@thread.v2', name: ' ' }), e)).status, 400);
});

t('invites: label, extra uses and extra days can be changed within limits', async () => {
  const e = env();
  const now = Date.now();
  assert.equal((await createInvite(post({ label: 'Pilot', uses: 2, days: 7 }), e, 'https://x.test')).status, 200);
  const id = (await (await accessInvites(e, { page: 1, size: 10, q: '' })).json()).items[0].id;
  const r = await (await editInvite(post({ label: 'Pilot B', addUses: 3, extendDays: 10 }), e, id, now)).json();
  assert.equal(r.invite.label, 'Pilot B');
  assert.equal(r.invite.usesLeft, 5);
  assert.equal((await editInvite(post({ addUses: 1000 }), e, id, now)).status, 400);
  assert.equal((await editInvite(post({ extendDays: 31 }), e, id, now)).status, 400);
  assert.equal((await editInvite(post({}), e, id, now)).status, 400);
  for (let i = 0; i < 5; i++) await editInvite(post({ extendDays: 30 }), e, id, now);
  const until = Date.parse((await (await accessInvites(e, { page: 1, size: 10, q: '' })).json()).items[0].expiresAt);
  assert.ok(until <= now + 60 * 86400e3 + 1000, 'never more than 60 days out');
  assert.equal((await (await accessInvites(e, { page: 1, size: 10, q: '' }, 'ended')).json()).total, 0);
});

t('person page works for someone with no usage, with access status and notes', async () => {
  const e = env();
  const key = H('c');
  e.DB.db.prepare("INSERT INTO access_people (account_hash, status, name, via, attempts, updated_at) VALUES (?, 'pending', 'Robin', NULL, 1, ?)").run(key, Date.now());
  const settings = { inactiveDays: 90, dailyCap: 200 };
  const p = await (await person(e, key, { settings })).json();
  assert.equal(p.noUsage, true);
  assert.equal(p.person.name, 'Robin');
  assert.equal(p.access.status, 'pending');
  assert.equal((await setPersonMeta(post({ tag: 'customer', org: 'Acme', note: 'Pilot lead' }), e, key)).status, 200);
  assert.deepEqual((await (await person(e, key, { settings })).json()).meta, { tag: 'customer', org: 'Acme', note: 'Pilot lead' });
  assert.equal((await setPersonMeta(post({ tag: 'vip' }), e, key)).status, 400);
  assert.equal((await person(e, H('d'), { settings })).status, 404);
  assert.equal((await setPersonLimit(post({ dailyWrites: 10 }), e, `conn:${key}`)).status, 400);
});

test('admin page renders without data and never inlines secrets', () => {
  const html = renderAdminPage({ configured: true });
  assert.match(html, /id="signinWrap"/);
  assert.match(html, /id="signinForm"/);
  assert.match(html, /id="codeField"/, 'two-factor code field');
  assert.doesNotMatch(html, /correct horse|tok_123/);
  assert.doesNotMatch(html, /fontshare|googleapis/, 'no third-party fonts');
  assert.match(renderAdminPage({ configured: false }), /not set up yet/);
});

test('admin page has one view per sidebar item, plus person and group views', () => {
  const html = renderAdminPage({ configured: true });
  const links = [...html.matchAll(/<li><a href="#(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ['overview', 'issues', 'people', 'access', 'usage', 'connections', 'settings']);
  for (const v of [...links, 'person', 'group']) assert.match(html, new RegExp(`<section class="view" id="v-${v}"`));
  assert.match(html, /class="skip"/, 'skip link');
});
