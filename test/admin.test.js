// Admin sign-in and sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminConfigured, makeSession, validSession, login, isAdmin, renderAdminPage } from '../src/remote/admin.js';

const env = (over = {}) => ({ KEY_SALT: 'salt', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'correct horse battery', ADMIN_TOKEN: 'tok_123', ...over });
const post = (body) => new Request('https://x.test/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('admin sign-in needs a username and a password of 12+ characters', () => {
  assert.equal(adminConfigured(env()), true);
  assert.equal(adminConfigured(env({ ADMIN_PASSWORD: 'short' })), false);
  assert.equal(adminConfigured(env({ ADMIN_USERNAME: '' })), false);
});

test('sessions expire, resist tampering and end when the password changes', async () => {
  const e = env();
  const s = await makeSession(e, Date.now());
  assert.equal(await validSession(e, s), true);
  const [exp, sig] = s.split('.');
  assert.equal(await validSession(e, `${Number(exp) + 3600e3}.${sig}`), false, 'extended expiry');
  assert.equal(await validSession(e, `${exp}.${sig.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))}`), false, 'altered signature');
  assert.equal(await validSession(e, await makeSession(e, Date.now() - 9 * 3600e3)), false, 'expired after 8 hours');
  assert.equal(await validSession(env({ ADMIN_PASSWORD: 'a brand new password' }), s), false, 'password change');
  assert.equal(await validSession(e, 'garbage'), false);
});

test('login: wrong credentials are refused and counted; right ones set a strict cookie', async () => {
  let fails = 0;
  const bad = await login(post({ username: 'admin', password: 'nope' }), env(), () => fails++);
  assert.equal(bad.status, 401);
  assert.equal(fails, 1);
  assert.equal(bad.headers.get('Set-Cookie'), null);
  const good = await login(post({ username: 'admin', password: 'correct horse battery' }), env());
  assert.equal(good.status, 200);
  const cookie = good.headers.get('Set-Cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/admin']) assert.ok(cookie.includes(flag), flag);
  assert.equal((await login(post({ username: 'admin', password: 'x' }), env({ ADMIN_PASSWORD: '' }))).status, 503);
});

test('isAdmin accepts a valid session cookie or the admin token, nothing else', async () => {
  const e = env();
  const cookie = `tpm_admin=${encodeURIComponent(await makeSession(e))}`;
  assert.equal(await isAdmin(new Request('https://x.test/admin/api/overview', { headers: { Cookie: cookie } }), e), true);
  assert.equal(await isAdmin(new Request('https://x.test/admin/api/overview', { headers: { Authorization: 'Bearer tok_123' } }), e), true);
  assert.equal(await isAdmin(new Request('https://x.test/admin/api/overview', { headers: { Authorization: 'Bearer wrong' } }), e), false);
  assert.equal(await isAdmin(new Request('https://x.test/admin/api/overview'), e), false);
});

test('admin page renders without data and never inlines secrets', () => {
  const html = renderAdminPage({ configured: true });
  assert.match(html, /<form class="signin" id="signinForm" hidden>/);
  assert.doesNotMatch(html, /correct horse|tok_123/);
  assert.match(renderAdminPage({ configured: false }), /not set up yet/);
});
