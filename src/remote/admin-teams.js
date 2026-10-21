// The admin's own Teams account, linked to the admin area.
//
// Used only to list the group chats the admin is in, so groups can be searched and added on the Access
// page, and to keep the admin's account approved. The sign-in is sealed (AES-GCM) under a key derived
// from KEY_SALT and ADMIN_PASSWORD: a database dump alone can't open it, and changing the admin password
// unlinks it (link again on the Access page). Every other person's sign-in stays sealed under their own key.
import { requestDeviceCode, pollDeviceCode, exchangeForSkypeToken, selfMri } from '../core/oauth.js';
import { createTeamsClient } from '../core/teams.js';
import { sealJson, openJson } from './crypto.js';
import { accountHash, approveAdminAccount } from './access.js';

const INFO = 'admin-teams-v1';
const LINK_INFO = 'admin-teams-link-v1';
const salt = (env) => env.KEY_SALT || 'msteams-personal-mcp';
const secret = (env) => `${salt(env)}|admin-teams|${env.ADMIN_PASSWORD}`;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const get = async (env, key) => (await env.DB.prepare('SELECT value FROM access_settings WHERE key = ?').bind(key).first())?.value ?? null;
const put = (env, key, value) => env.DB.prepare('INSERT INTO access_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
const drop = (env, key) => env.DB.prepare('DELETE FROM access_settings WHERE key = ?').bind(key);

/** { linked, name, key (account hash), linkedAt } of the admin's Teams account. */
export async function adminTeamsInfo(env) {
  const raw = await get(env, 'admin_teams_info');
  const info = raw ? JSON.parse(raw) : null;
  return info ? { linked: true, ...info } : { linked: false, name: null, key: null, linkedAt: null };
}

export async function teamsStatus(env) {
  return json(await adminTeamsInfo(env));
}

export async function startLink(env) {
  const dc = await requestDeviceCode();
  await put(env, 'admin_teams_link', JSON.stringify({
    sealed: await sealJson(secret(env), salt(env), LINK_INFO, { deviceCode: dc.deviceCode }),
    interval: dc.interval, next: Date.now() + dc.interval * 1000, expires: dc.expiresAt,
  })).run();
  return json({ userCode: dc.userCode, verificationUrl: dc.verificationUrl, interval: dc.interval });
}

export async function pollLink(env) {
  const raw = await get(env, 'admin_teams_link');
  const link = raw ? JSON.parse(raw) : null;
  const now = Date.now();
  if (!link || link.expires < now) return json({ status: 'error', error: 'The code expired. Start again.' }, 410);
  if (now < link.next) return json({ status: 'pending', interval: link.interval });

  const { deviceCode } = await openJson(secret(env), salt(env), LINK_INFO, link.sealed);
  let result;
  try {
    result = await pollDeviceCode(deviceCode);
  } catch (e) {
    await drop(env, 'admin_teams_link').run();
    return json({ status: 'error', error: e.message }, 400);
  }
  if (result.status !== 'approved') {
    const interval = link.interval + (result.status === 'slow_down' ? 5 : 0);
    await put(env, 'admin_teams_link', JSON.stringify({ ...link, interval, next: now + interval * 1000 })).run();
    return json({ status: 'pending', interval });
  }

  const s = await exchangeForSkypeToken(result.refreshToken);
  const mri = selfMri(s.token);
  if (!mri) return json({ status: 'error', error: 'Could not read the Teams account. Try again.' }, 400);
  const skype = { token: s.token, expiresAt: s.expiresAt, region: s.region };
  const name = await createTeamsClient(async () => skype).displayName().catch(() => null);
  const key = await accountHash(env, mri);
  await env.DB.batch([
    put(env, 'admin_teams', await sealJson(secret(env), salt(env), INFO, { refreshToken: s.refreshToken, skype })),
    put(env, 'admin_teams_info', JSON.stringify({ name, key, linkedAt: new Date(now).toISOString() })),
    drop(env, 'admin_teams_link'),
  ]);
  await approveAdminAccount(env, key, name);
  return json({ status: 'linked', name });
}

/** Unlinking forgets the sign-in; the account keeps its approval. */
export async function unlink(env) {
  await env.DB.batch([drop(env, 'admin_teams'), drop(env, 'admin_teams_info'), drop(env, 'admin_teams_link')]);
  return json({ ok: true });
}

function adminClient(env) {
  return createTeamsClient(async () => {
    const sealed = await get(env, 'admin_teams');
    if (!sealed) throw Object.assign(new Error('Link your Teams account first.'), { unlinked: true });
    let data;
    try { data = await openJson(secret(env), salt(env), INFO, sealed); } catch {
      throw Object.assign(new Error('The admin password changed since your Teams account was linked. Link it again.'), { unlinked: true });
    }
    if (data.skype && Date.now() < data.skype.expiresAt - 60_000) return data.skype;
    const s = await exchangeForSkypeToken(data.refreshToken);
    const skype = { token: s.token, expiresAt: s.expiresAt, region: s.region };
    await put(env, 'admin_teams', await sealJson(secret(env), salt(env), INFO, { refreshToken: s.refreshToken, skype })).run();
    return skype;
  });
}

/** The group chats the admin is in, marked when already added as an access group. */
export async function myGroups(env) {
  let groups;
  try {
    groups = await adminClient(env).listGroupChats();
  } catch (e) {
    return json({ error: e.message, unlinked: Boolean(e.unlinked) }, e.unlinked ? 409 : 502);
  }
  const added = new Set(((await env.DB.prepare('SELECT conversation_id FROM access_groups').all()).results || []).map((r) => r.conversation_id));
  return json({ groups: groups.map((g) => ({ ...g, added: added.has(g.id) })) });
}
