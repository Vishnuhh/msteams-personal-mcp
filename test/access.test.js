import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  accessMode, setMode, decideSignIn, connectionAccess, recheckMember, personAccess, createInvite, inviteValid, REFUSED, approveAdminAccount,
} from '../src/remote/access.js';

// Real SQLite with the real migrations, wrapped in the small part of the D1 API the code uses.
// node:sqlite ships with Node 22.13+; older Node skips these tests.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* not available */ }
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
  return { db, prepare, batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const GROUP = '19:abc123@thread.v2';
const client = (groups = [], { fail = false } = {}) => ({
  membership: async (id) => {
    if (fail) throw new Error('Teams is limiting requests');
    return { member: groups.includes(id), topic: 'Squad' };
  },
});
const person = (env, h) => env.DB.prepare('SELECT * FROM access_people WHERE account_hash = ?').bind(h).first();
const post = (body) => new Request('https://x.test/', { method: 'POST', body: JSON.stringify(body) });

t('restricted by default once the admin area is set up; open otherwise', async () => {
  assert.equal((await accessMode({ DB: d1() }, { defaultRestricted: true })).restricted, true);
  assert.equal((await accessMode({ DB: d1() }, { defaultRestricted: false })).restricted, false);
  const env = { DB: d1() };
  await setMode(post({ mode: 'open' }), env, { restricted: true });
  assert.equal((await accessMode(env, { defaultRestricted: true })).restricted, false, 'a saved choice wins');
});

t('strangers are refused, nothing stored, and queued once per account', async () => {
  const env = { DB: d1() };
  const r = await decideSignIn(env, { hash: H1, mri: '8:live:x', name: 'Casey', client: client() });
  assert.deepEqual(r, { ok: false, error: REFUSED });
  await decideSignIn(env, { hash: H1, mri: '8:live:x', name: 'Casey', client: client() });
  const p = await person(env, H1);
  assert.equal(p.status, 'pending');
  assert.equal(p.attempts, 2);
  assert.equal(p.name, 'Casey');
});

t('members of an access group get in, and the group takes its Teams name', async () => {
  const env = { DB: d1() };
  await env.DB.prepare('INSERT INTO access_groups (conversation_id, name, added_at) VALUES (?, NULL, 1)').bind(GROUP).run();
  assert.equal((await decideSignIn(env, { hash: H1, mri: '8:live:x', name: 'Avery', client: client([GROUP]) })).ok, true);
  const p = await person(env, H1);
  assert.equal(p.status, 'member');
  assert.equal(p.via, `group:${GROUP}`);
  assert.equal((await env.DB.prepare('SELECT name FROM access_groups').first()).name, 'Squad');
});

t('invite links let people in until their uses run out', async () => {
  const env = { DB: d1() };
  const { link } = await (await createInvite(post({ label: 'Acme', uses: 1, days: 7 }), env, 'https://x.test')).json();
  const code = new URL(link).searchParams.get('invite');
  assert.equal(await inviteValid(env, code), true);
  assert.equal((await decideSignIn(env, { hash: H1, mri: '8:live:x', invite: code, client: client() })).ok, true);
  assert.equal((await person(env, H1)).via, 'invite:Acme');
  assert.equal(await inviteValid(env, code), false, 'used up');
  assert.equal((await decideSignIn(env, { hash: H2, mri: '8:live:y', invite: code, client: client() })).ok, false);
});

t('blocked accounts stay out; an unanswered group check is not a refusal', async () => {
  const env = { DB: d1() };
  await env.DB.prepare('INSERT INTO access_groups (conversation_id, name, added_at) VALUES (?, ?, 1)').bind(GROUP, 'Squad').run();
  const unsure = await decideSignIn(env, { hash: H1, mri: '8:live:x', client: client([], { fail: true }) });
  assert.equal(unsure.ok, false);
  assert.match(unsure.error, /Try again/);
  assert.equal(await person(env, H1), null, 'not queued');

  await personAccess(env, H2, 'block');
  assert.equal((await decideSignIn(env, { hash: H2, mri: '8:live:y', client: client([GROUP]) })).ok, false, 'group membership does not override a block');
});

t('connections: earlier ones go to review, later strangers are cut off, members are re-checked daily', async () => {
  const env = { DB: d1() };
  const mode = { restricted: true, since: 1000 };
  assert.equal(await connectionAccess(env, mode, { created_at: 500, account_hash: H1, account_name: 'Avery' }), 'ok');
  assert.equal((await person(env, H1)).status, 'review');
  assert.equal(await connectionAccess(env, mode, { created_at: 2000, account_hash: H2 }), 'denied');
  assert.equal(await connectionAccess(env, mode, { created_at: 2000, account_hash: H2, access_status: 'pending' }), 'denied');
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(await connectionAccess(env, mode, { created_at: 2000, account_hash: H2, access_status: 'member', access_checked: '2026-10-21' }, now), 'ok');
  assert.equal(await connectionAccess(env, mode, { created_at: 2000, account_hash: H2, access_status: 'member', access_checked: '2026-10-20' }, now), 'recheck');
  assert.equal(await connectionAccess(env, { restricted: false, since: 0 }, { created_at: 2000, account_hash: H2 }), 'ok', 'open mode');
});

t('leaving every access group ends all of that person\'s connections', async () => {
  const env = { DB: d1() };
  await env.DB.prepare('INSERT INTO access_groups (conversation_id, name, added_at) VALUES (?, ?, 1)').bind(GROUP, 'Squad').run();
  await env.DB.prepare("INSERT INTO access_people (account_hash, status, via, updated_at) VALUES (?, 'member', ?, 1)").bind(H1, `group:${GROUP}`).run();
  await env.DB.prepare('INSERT INTO users (id, data, created_at, updated_at, account_hash) VALUES (?, ?, 1, 1, ?)').bind('u1', 'x', H1).run();
  assert.equal(await recheckMember(env, client([GROUP]), H1), true);
  assert.equal(await recheckMember(env, client([]), H1), false);
  assert.equal((await person(env, H1)).status, 'pending');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 0);
});

t('the admin\'s own linked account is approved and cannot be blocked or removed', async () => {
  const env = { DB: d1() };
  await approveAdminAccount(env, H1, 'Admin');
  assert.equal((await person(env, H1)).via, 'admin account');
  for (const action of ['block', 'remove']) {
    assert.equal((await personAccess(env, H1, action, { adminKey: H1 })).status, 400, action);
  }
  assert.equal((await person(env, H1)).status, 'approved');
  assert.equal((await decideSignIn(env, { hash: H1, mri: '8:live:admin', client: client() })).ok, true);
});

t('switching from open to restricted sends earlier connections to review', async () => {
  const env = { DB: d1() };
  await setMode(post({ mode: 'open' }), env, { restricted: true });
  const before = Date.now();
  await setMode(post({ mode: 'restricted' }), env, { restricted: false });
  assert.ok((await accessMode(env)).since >= before);
});
