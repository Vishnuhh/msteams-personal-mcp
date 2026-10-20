// Local (single-user) sign-in state: device-code login polled in the background,
// refresh token kept in the encrypted file store, skypetoken cached in memory.
import { readStore, writeStore, clearStore } from './store.js';
import { requestDeviceCode, pollDeviceCode, exchangeForSkypeToken } from './core/oauth.js';

let pendingLogin = null; // { userCode, verificationUrl, expiresAt, promise, done, error }
let skypeCache = null; // { token, expiresAt, region }

/** Start device-code sign-in. Returns the code to show the user; polling continues in the background. */
export async function startLogin() {
  if (pendingLogin && Date.now() < pendingLogin.expiresAt && !pendingLogin.error && !pendingLogin.done) {
    return pendingLogin;
  }
  const dc = await requestDeviceCode();
  const login = { userCode: dc.userCode, verificationUrl: dc.verificationUrl, expiresAt: dc.expiresAt, done: false, error: null };
  login.promise = (async () => {
    let wait = dc.interval * 1000;
    while (Date.now() < dc.expiresAt) {
      await new Promise((res) => setTimeout(res, wait));
      const r = await pollDeviceCode(dc.deviceCode);
      if (r.status === 'pending') continue;
      if (r.status === 'slow_down') { wait += 5000; continue; }
      writeStore({ refreshToken: r.refreshToken, savedAt: new Date().toISOString() });
      skypeCache = null;
      await getSkypeToken(); // verify the whole chain works
      login.done = true;
      return;
    }
    throw new Error('Sign-in code expired before it was approved. Start login again.');
  })().catch((e) => { login.error = e.message; throw e; });
  login.promise.catch(() => {}); // error is surfaced via loginState()
  pendingLogin = login;
  return login;
}

export function loginState() {
  if (!pendingLogin) return null;
  const { userCode, verificationUrl, expiresAt, done, error } = pendingLogin;
  return { userCode, verificationUrl, expiresAt: new Date(expiresAt).toISOString(), done, error };
}

export function waitForLogin() {
  return pendingLogin ? pendingLogin.promise : Promise.resolve();
}

export function logout() {
  clearStore();
  skypeCache = null;
  pendingLogin = null;
}

export function hasSavedLogin() {
  return Boolean(readStore().refreshToken);
}

/** Returns a valid skypetoken for teams.live.com chat APIs, refreshing as needed. */
export async function getSkypeToken() {
  if (skypeCache && Date.now() < skypeCache.expiresAt - 60_000) return skypeCache;
  const store = readStore();
  if (!store.refreshToken) {
    throw new Error('Not signed in. Call teams_login (or run `npm run cli -- login`) first.');
  }
  const s = await exchangeForSkypeToken(store.refreshToken);
  if (s.refreshToken !== store.refreshToken) writeStore({ ...store, refreshToken: s.refreshToken });
  skypeCache = { token: s.token, expiresAt: s.expiresAt, region: s.region };
  return skypeCache;
}
