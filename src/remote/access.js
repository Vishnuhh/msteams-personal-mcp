// Who may use the server.
//
// Restricted mode (the default once admin sign-in is set up): an account may connect when it is
//   - a member of one of the admin's chosen Teams group chats (checked with the person's own sign-in,
//     at sign-in and again once a day; leaving the group ends their connections), or
//   - approved: through an invite link, by the admin, or listed in ALLOWED_ACCOUNTS, or
//   - in review: it was already connected when access was restricted (works until the admin decides).
// Anyone else is refused at sign-in, their Microsoft sign-in is never stored, and they wait in the
// admin's request queue. Open mode lets every personal Microsoft account in (the old behaviour).
//
// Accounts are identified only by their HMAC account hash, as in the usage tables.
import { newSecret, sha256Hex, hmacHex } from './crypto.js';

/** Keyed hash of a Teams account id (8:live:…): the only account identifier the server stores. */
export const accountHash = (env, mri) => hmacHex(env.KEY_SALT || 'msteams-personal-mcp', `account|${mri}`);

const DAY_MS = 24 * 60 * 60 * 1000;
const OK = new Set(['member', 'approved', 'review']);
const HASH_RE = /^[0-9a-f]{64}$/;
const GROUP_RE = /^19:[A-Za-z0-9_.-]+@thread\.(v2|skype)$/;
const MAX_GROUPS = 50;
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// ---------------------------------------------------------------- mode

const modeCache = new WeakMap(); // env.DB -> { at, value }, per isolate; other isolates catch up within MODE_TTL_MS
const MODE_TTL_MS = 30_000;

/** { restricted, since }. Without a saved choice, restricted when the admin area is set up (someone can approve). */
export async function accessMode(env, { defaultRestricted = false } = {}) {
  const hit = modeCache.get(env.DB);
  if (hit && Date.now() - hit.at < MODE_TTL_MS) return hit.value;
  const rows = (await env.DB.prepare('SELECT key, value FROM access_settings').all().catch(() => ({ results: [] }))).results || [];
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const value = { restricted: s.mode ? s.mode === 'restricted' : defaultRestricted, since: Number(s.restricted_since) || 0 };
  modeCache.set(env.DB, { at: Date.now(), value });
  return value;
}

export async function setMode(request, env, current) {
  const { mode } = await request.json().catch(() => ({}));
  if (mode !== 'restricted' && mode !== 'open') return json({ error: 'Mode must be "restricted" or "open".' }, 400);
  const stmts = [env.DB.prepare("INSERT INTO access_settings (key, value) VALUES ('mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(mode)];
  // Connections made while the server was open go to review rather than being cut off.
  if (mode === 'restricted' && !current.restricted) {
    stmts.push(env.DB.prepare("INSERT INTO access_settings (key, value) VALUES ('restricted_since', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(Date.now())));
  }
  await env.DB.batch(stmts);
  modeCache.delete(env.DB);
  return json({ ok: true, mode });
}

// ---------------------------------------------------------------- people

function setPerson(env, hash, { status, name = null, via = null, checkedDay = null, request = false, now = Date.now() }) {
  return env.DB.prepare(
    'INSERT INTO access_people (account_hash, status, name, via, checked_day, attempts, requested_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(account_hash) DO UPDATE SET status = excluded.status, name = COALESCE(excluded.name, access_people.name), ' +
    'via = COALESCE(excluded.via, access_people.via), checked_day = excluded.checked_day, attempts = access_people.attempts + excluded.attempts, ' +
    'requested_at = COALESCE(excluded.requested_at, access_people.requested_at), updated_at = excluded.updated_at',
  ).bind(hash, status, name, via, checkedDay, request ? 1 : 0, request ? now : null, now).run();
}

const getPerson = (env, hash) => env.DB.prepare('SELECT * FROM access_people WHERE account_hash = ?').bind(hash).first();
const listGroups = async (env) => (await env.DB.prepare('SELECT conversation_id, name FROM access_groups ORDER BY added_at').all()).results || [];

/**
 * Checks the person's own group memberships. { member: group | null, unsure: boolean }; unsure means
 * Teams could not answer for some group (throttling, outage), so "not a member" is not certain.
 */
async function findGroup(env, client, groups) {
  let unsure = false;
  for (const g of groups) {
    try {
      const m = await client.membership(g.conversation_id);
      if (m.member) {
        if (!g.name && m.topic) await env.DB.prepare('UPDATE access_groups SET name = ? WHERE conversation_id = ?').bind(m.topic.slice(0, 80), g.conversation_id).run();
        return { member: g, unsure };
      }
    } catch { unsure = true; }
  }
  return { member: null, unsure };
}

// ---------------------------------------------------------------- invites

export async function inviteValid(env, code, now = Date.now()) {
  if (typeof code !== 'string' || !/^inv_[A-Za-z0-9_-]{20,}$/.test(code)) return false;
  return Boolean(await env.DB.prepare('SELECT 1 FROM access_invites WHERE id = ? AND uses_left > 0 AND expires_at > ?').bind(await sha256Hex(code), now).first());
}

/** Uses one place on the invite; returns its label (or '' if unlabelled), or null when it can't be used. */
async function useInvite(env, code, now) {
  const row = await env.DB.prepare('UPDATE access_invites SET uses_left = uses_left - 1, used = used + 1 WHERE id = ? AND uses_left > 0 AND expires_at > ? RETURNING label')
    .bind(await sha256Hex(code), now).first();
  return row ? row.label || '' : null;
}

// ---------------------------------------------------------------- decisions

export const REFUSED = "You don't have access to this server yet. Your request is now with its admin: sign in again once you're approved, or open the invite link you were sent.";

/**
 * Restricted mode, right after Microsoft approved a sign-in and before anything is stored.
 * Returns { ok: true } or { ok: false, error }; refused accounts are queued for the admin.
 */
export async function decideSignIn(env, { hash, mri, name, invite, client, allowList = [], now = Date.now() }) {
  const row = await getPerson(env, hash);
  if (row?.status === 'blocked') return { ok: false, error: "This account can't use this server. Ask its admin if that's a mistake." };
  if (allowList.some((a) => a === mri || `8:${a}` === mri)) {
    await setPerson(env, hash, { status: 'approved', name, via: 'allow-list', now });
    return { ok: true };
  }
  if (row && (row.status === 'approved' || row.status === 'review')) return { ok: true };
  if (row?.status === 'member' && row.checked_day === today(now)) return { ok: true };

  const { member, unsure } = await findGroup(env, client, await listGroups(env));
  if (member) {
    await setPerson(env, hash, { status: 'member', name, via: `group:${member.conversation_id}`, checkedDay: today(now), now });
    return { ok: true };
  }
  if (invite) {
    const label = await useInvite(env, invite, now);
    if (label !== null) {
      await setPerson(env, hash, { status: 'approved', name, via: `invite:${label}`, now });
      return { ok: true };
    }
  }
  if (unsure) return { ok: false, error: 'Teams did not answer when checking your group membership. Try again in a minute.' };
  if (row?.status === 'member') {
    // Left every access group since the last check.
    await env.DB.prepare('DELETE FROM users WHERE account_hash = ?').bind(hash).run();
  }
  await setPerson(env, hash, { status: 'pending', name, via: row?.status === 'member' ? 'left group' : null, request: true, now });
  return { ok: false, error: REFUSED };
}

/**
 * Restricted mode, on each MCP request. Returns 'ok', 'recheck' (allowed; re-check group membership
 * in the background) or 'denied'. `row` carries the connection's created_at, account_hash, account_name
 * and the joined access_status / access_checked.
 */
export async function connectionAccess(env, mode, row, now = Date.now()) {
  if (!mode.restricted || !row.account_hash) return 'ok'; // very old connections get their hash on first use
  const status = row.access_status;
  if (status === 'approved' || status === 'review') return 'ok';
  if (status === 'member') return row.access_checked === today(now) ? 'ok' : 'recheck';
  if (status) return 'denied';
  if (row.created_at < mode.since) {
    await setPerson(env, row.account_hash, { status: 'review', name: row.account_name || null, via: 'connected before', now });
    return 'ok';
  }
  return 'denied';
}

/** Daily group re-check for a member. Leaving every access group ends all their connections. */
export async function recheckMember(env, client, hash, now = Date.now()) {
  const { member, unsure } = await findGroup(env, client, await listGroups(env));
  if (member || unsure) {
    // Unsure: try again tomorrow rather than on every request.
    await env.DB.prepare('UPDATE access_people SET checked_day = ?, via = COALESCE(?, via), updated_at = ? WHERE account_hash = ?')
      .bind(today(now), member ? `group:${member.conversation_id}` : null, now, hash).run();
    return true;
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE access_people SET status = 'pending', via = 'left group', requested_at = ?, updated_at = ? WHERE account_hash = ?").bind(now, now, hash),
    env.DB.prepare('DELETE FROM users WHERE account_hash = ?').bind(hash),
  ]);
  return false;
}

// ---------------------------------------------------------------- admin

/** Lists everyone connected before access was restricted for review, without waiting for their next request. */
function syncReview(env, mode, now = Date.now()) {
  if (!mode.restricted) return Promise.resolve();
  return env.DB.prepare(
    "INSERT OR IGNORE INTO access_people (account_hash, status, name, via, attempts, updated_at) " +
    "SELECT account_hash, 'review', MAX(account_name), 'connected before', 0, ? FROM users WHERE account_hash IS NOT NULL AND created_at < ? GROUP BY account_hash",
  ).bind(now, mode.since).run().catch(() => {});
}

export async function addGroup(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.conversationId || '').trim();
  const name = String(body.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || null;
  if (!GROUP_RE.test(id)) return json({ error: 'That is not a group chat id. It looks like 19:…@thread.v2 (ask Claude for the chat id of the group).' }, 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM access_groups').first();
  if ((n?.n ?? 0) >= MAX_GROUPS) return json({ error: `At most ${MAX_GROUPS} groups.` }, 400);
  await env.DB.prepare('INSERT INTO access_groups (conversation_id, name, added_at) VALUES (?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET name = COALESCE(excluded.name, access_groups.name)')
    .bind(id, name, Date.now()).run();
  return json({ ok: true });
}

/** Removing a group doesn't cut anyone off at once: its members lose access at their next daily check. */
export async function removeGroup(request, env) {
  const { conversationId } = await request.json().catch(() => ({}));
  if (!GROUP_RE.test(String(conversationId || ''))) return json({ error: 'Unknown group.' }, 400);
  await env.DB.prepare('DELETE FROM access_groups WHERE conversation_id = ?').bind(conversationId).run();
  await env.DB.prepare("UPDATE access_people SET checked_day = NULL WHERE status = 'member' AND via = ?").bind(`group:${conversationId}`).run();
  return json({ ok: true });
}

export async function createInvite(request, env, origin) {
  const body = await request.json().catch(() => ({}));
  const label = String(body.label || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  const uses = Number(body.uses ?? 1);
  const days = Number(body.days ?? 7);
  if (!Number.isInteger(uses) || uses < 1 || uses > 500) return json({ error: 'Uses must be a whole number from 1 to 500.' }, 400);
  if (!Number.isInteger(days) || days < 1 || days > 30) return json({ error: 'Days must be a whole number from 1 to 30.' }, 400);
  const code = newSecret('inv');
  const now = Date.now();
  await env.DB.prepare('INSERT INTO access_invites (id, label, uses_left, used, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)')
    .bind(await sha256Hex(code), label || null, uses, now + days * DAY_MS, now).run();
  return json({ ok: true, link: `${origin}/?invite=${code}` });
}

export async function revokeInvite(env, id) {
  if (!HASH_RE.test(id || '')) return json({ error: 'Unknown invite.' }, 400);
  await env.DB.prepare('UPDATE access_invites SET uses_left = 0 WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

/** The admin's linked Teams account always has access. */
export function approveAdminAccount(env, key, name) {
  return setPerson(env, key, { status: 'approved', name, via: 'admin account' });
}

/** approve | block | remove | unblock for one person: { ok } or { error }. Block and remove end their connections. */
async function applyAccess(env, key, action, { adminKey = null, now = Date.now() } = {}) {
  if (!HASH_RE.test(key || '')) return { error: 'Unknown person.' };
  if (key === adminKey && action !== 'approve') return { error: 'That is your own admin account. Unlink it on the Access page first.' };
  const row = await getPerson(env, key);
  if (action === 'approve') {
    await setPerson(env, key, { status: 'approved', name: row?.name || null, via: 'admin', now });
    return { ok: true };
  }
  if (action === 'block') {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO access_people (account_hash, status, updated_at) VALUES (?, 'blocked', ?) ON CONFLICT(account_hash) DO UPDATE SET status = 'blocked', updated_at = excluded.updated_at").bind(key, now),
      env.DB.prepare('DELETE FROM users WHERE account_hash = ?').bind(key),
    ]);
    return { ok: true };
  }
  if (action === 'remove' || action === 'unblock') {
    const stmts = [env.DB.prepare('DELETE FROM access_people WHERE account_hash = ?').bind(key)];
    if (action === 'remove') stmts.push(env.DB.prepare('DELETE FROM users WHERE account_hash = ?').bind(key));
    await env.DB.batch(stmts);
    return { ok: true };
  }
  return { error: 'Unknown action.' };
}

export async function personAccess(env, key, action, options = {}) {
  const r = await applyAccess(env, key, action, options);
  return json(r.error ? { error: r.error } : { ok: true }, r.error ? 400 : 200);
}

/** POST /admin/api/access/bulk { keys: [...], action }: up to 50 people at once. */
export async function bulkAccess(request, env, { adminKey = null } = {}) {
  const { keys, action } = await request.json().catch(() => ({}));
  if (!['approve', 'block', 'remove', 'unblock'].includes(action)) return json({ error: 'Unknown action.' }, 400);
  if (!Array.isArray(keys) || !keys.length || keys.length > 50) return json({ error: 'Select 1 to 50 people.' }, 400);
  let done = 0;
  const failed = [];
  for (const key of [...new Set(keys)]) {
    const r = await applyAccess(env, key, action, { adminKey });
    if (r.ok) done++; else failed.push(r.error);
  }
  return json({ ok: true, done, failed: failed.length, reason: failed[0] || null });
}

// ---------------------------------------------------------------- paged lists for the Access tabs

const STATUS_SETS = { requests: ['pending'], review: ['review'], allowed: ['member', 'approved'], blocked: ['blocked'] };

/** Counts for every Access tab. */
export async function accessCounts(env, mode) {
  await syncReview(env, mode);
  const rows = (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM access_people GROUP BY status').all()).results || [];
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const groups = (await env.DB.prepare('SELECT COUNT(*) AS n FROM access_groups').first())?.n ?? 0;
  const invites = (await env.DB.prepare('SELECT SUM(CASE WHEN uses_left > 0 AND expires_at > ? THEN 1 ELSE 0 END) AS active, COUNT(*) AS total FROM access_invites').bind(Date.now()).first()) || {};
  return {
    requests: by.pending || 0, review: by.review || 0, allowed: (by.member || 0) + (by.approved || 0), blocked: by.blocked || 0,
    groups, invitesActive: invites.active || 0, invites: invites.total || 0,
  };
}

/** GET /admin/api/access/people?status=requests|review|allowed|blocked&q=&page=&size= */
export async function accessPeople(env, { status, page, size, q }, { adminKey = null } = {}) {
  const set = STATUS_SETS[status];
  if (!set) return json({ error: 'Unknown list.' }, 400);
  const marks = set.map(() => '?').join(',');
  const where = `p.status IN (${marks})${q ? ' AND (p.name LIKE ? OR m.org LIKE ?)' : ''}`;
  const args = [...set, ...(q ? [`%${q}%`, `%${q}%`] : [])];
  const order = status === 'requests' ? 'COALESCE(p.requested_at, p.updated_at) DESC' : 'p.updated_at DESC';
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM access_people p LEFT JOIN person_meta m ON m.account_hash = p.account_hash WHERE ${where}`).bind(...args).first())?.n ?? 0;
  const rows = (await env.DB.prepare(
    `SELECT p.account_hash, p.status, p.name, p.via, p.attempts, p.requested_at, p.updated_at, m.tag, m.org,
       (SELECT name FROM access_groups g WHERE 'group:' || g.conversation_id = p.via) AS group_name,
       (SELECT COUNT(*) FROM users u WHERE u.account_hash = p.account_hash) AS connections
     FROM access_people p LEFT JOIN person_meta m ON m.account_hash = p.account_hash WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).bind(...args, size, (page - 1) * size).all()).results || [];
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  return json({
    items: rows.map((r) => ({
      key: r.account_hash, status: r.status, name: r.name, via: r.via, groupName: r.group_name, attempts: r.attempts, connections: r.connections,
      requestedAt: iso(r.requested_at), updatedAt: iso(r.updated_at), tag: r.tag, org: r.org, you: r.account_hash === adminKey,
    })),
    total, page, size, status,
  });
}

/** GET /admin/api/access/groups?q=&page=&size= */
export async function accessGroups(env, { page, size, q }) {
  const where = q ? 'WHERE g.name LIKE ? OR g.conversation_id LIKE ?' : '';
  const args = q ? [`%${q}%`, `%${q}%`] : [];
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM access_groups g ${where}`).bind(...args).first())?.n ?? 0;
  const rows = (await env.DB.prepare(
    `SELECT g.conversation_id, g.name, g.added_at, (SELECT COUNT(*) FROM access_people p WHERE p.status = 'member' AND p.via = 'group:' || g.conversation_id) AS members
     FROM access_groups g ${where} ORDER BY g.added_at DESC LIMIT ? OFFSET ?`,
  ).bind(...args, size, (page - 1) * size).all()).results || [];
  return json({ items: rows.map((g) => ({ id: g.conversation_id, name: g.name, addedAt: new Date(g.added_at).toISOString(), members: g.members })), total, page, size });
}

/** GET /admin/api/access/group?id=&page=&size=&q=: one group and the people who got in through it. */
export async function groupDetail(env, id, { page, size, q }) {
  if (!GROUP_RE.test(id || '')) return json({ error: 'Unknown group.' }, 400);
  const g = await env.DB.prepare('SELECT conversation_id, name, added_at FROM access_groups WHERE conversation_id = ?').bind(id).first();
  if (!g) return json({ error: 'This group is not an access group any more.' }, 404);
  const where = `status = 'member' AND via = ?${q ? ' AND name LIKE ?' : ''}`;
  const args = [`group:${id}`, ...(q ? [`%${q}%`] : [])];
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM access_people WHERE ${where}`).bind(...args).first())?.n ?? 0;
  const rows = (await env.DB.prepare(`SELECT account_hash, name, checked_day, updated_at FROM access_people WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .bind(...args, size, (page - 1) * size).all()).results || [];
  return json({
    group: { id: g.conversation_id, name: g.name, addedAt: new Date(g.added_at).toISOString(), members: total },
    items: rows.map((r) => ({ key: r.account_hash, name: r.name, checkedDay: r.checked_day, since: new Date(r.updated_at).toISOString() })),
    total, page, size,
  });
}

/** POST /admin/api/access/groups/rename { conversationId, name } */
export async function renameGroup(request, env) {
  const { conversationId, name } = await request.json().catch(() => ({}));
  if (!GROUP_RE.test(String(conversationId || ''))) return json({ error: 'Unknown group.' }, 400);
  const clean = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  if (!clean) return json({ error: 'Give the group a name.' }, 400);
  const r = await env.DB.prepare('UPDATE access_groups SET name = ? WHERE conversation_id = ?').bind(clean, conversationId).run();
  if (!(r.meta?.changes ?? 0)) return json({ error: 'This group is not an access group any more.' }, 404);
  return json({ ok: true, name: clean });
}

/** GET /admin/api/access/invites?state=active|ended&q=&page=&size= */
export async function accessInvites(env, { page, size, q }, state = 'active', now = Date.now()) {
  const live = 'uses_left > 0 AND expires_at > ?';
  const where = `${state === 'ended' ? `NOT (${live})` : live}${q ? ' AND label LIKE ?' : ''}`;
  const args = [now, ...(q ? [`%${q}%`] : [])];
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM access_invites WHERE ${where}`).bind(...args).first())?.n ?? 0;
  const rows = (await env.DB.prepare(`SELECT id, label, uses_left, used, expires_at, created_at FROM access_invites WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...args, size, (page - 1) * size).all()).results || [];
  const iso = (t) => new Date(t).toISOString();
  return json({
    items: rows.map((i) => ({ id: i.id, label: i.label, usesLeft: i.uses_left, used: i.used, expiresAt: iso(i.expires_at), createdAt: iso(i.created_at), active: i.uses_left > 0 && i.expires_at > now })),
    total, page, size, state: state === 'ended' ? 'ended' : 'active',
  });
}

/** POST /admin/api/access/invites/<id>/edit { label?, addUses?, extendDays? } */
export async function editInvite(request, env, id, now = Date.now()) {
  if (!HASH_RE.test(id || '')) return json({ error: 'Unknown invite.' }, 400);
  const inv = await env.DB.prepare('SELECT label, uses_left, expires_at FROM access_invites WHERE id = ?').bind(id).first();
  if (!inv) return json({ error: 'Unknown invite.' }, 404);
  const body = await request.json().catch(() => ({}));
  let { label, uses_left: usesLeft, expires_at: expiresAt } = inv;
  const changes = [];
  if ('label' in body) { label = String(body.label || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || null; changes.push('label'); }
  if (body.addUses !== undefined && body.addUses !== null && body.addUses !== '') {
    const n = Number(body.addUses);
    if (!Number.isInteger(n) || n < 1 || usesLeft + n > 500) return json({ error: 'Add 1 or more uses, up to 500 left in total.' }, 400);
    usesLeft += n; changes.push(`+${n} uses`);
  }
  if (body.extendDays !== undefined && body.extendDays !== null && body.extendDays !== '') {
    const n = Number(body.extendDays);
    if (!Number.isInteger(n) || n < 1 || n > 30) return json({ error: 'Extend by 1 to 30 days.' }, 400);
    expiresAt = Math.min(Math.max(expiresAt, now) + n * DAY_MS, now + 60 * DAY_MS); changes.push(`+${n} days`);
  }
  if (!changes.length) return json({ error: 'Nothing to change.' }, 400);
  await env.DB.prepare('UPDATE access_invites SET label = ?, uses_left = ?, expires_at = ? WHERE id = ?').bind(label, usesLeft, expiresAt, id).run();
  return json({ ok: true, changes, invite: { id, label, usesLeft, expiresAt: new Date(expiresAt).toISOString(), active: usesLeft > 0 && expiresAt > now } });
}

/** Nightly: forget old unanswered requests and long-expired invites. */
export function cleanupStatements(env, now = Date.now()) {
  return [
    env.DB.prepare("DELETE FROM access_people WHERE status = 'pending' AND COALESCE(requested_at, updated_at) < ?").bind(now - 90 * DAY_MS),
    env.DB.prepare('DELETE FROM access_invites WHERE expires_at < ?').bind(now - 30 * DAY_MS),
  ];
}
