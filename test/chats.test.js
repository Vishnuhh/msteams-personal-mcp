// Any number of chats: list pages through older ones, find_chat searches all of them through a remembered index,
// and both can be limited to group chats or 1:1 chats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamsClient } from '../src/core/teams.js';

let run = 0;
/**
 * A fake Teams with `total` chats, newest first, 100 per page: every 5th one a group ("Group N"), the rest 1:1 chats
 * whose last message is from the other person ("Person N").
 */
function fakeTeams(total = 250) {
  const self = `live:chats${++run}`; // a new account per test, so the in-memory caches start empty
  const jwt = `x.${Buffer.from(JSON.stringify({ skypeid: self })).toString('base64url')}.y`;
  const chats = Array.from({ length: total }, (_, i) => (i % 5 === 0
    ? { id: `19:group${run}x${i}@thread.v2`, threadProperties: { topic: `Group ${i}` }, lastMessage: {} }
    : {
      id: `19:uni01_chat${run}x${i}@thread.v2`,
      threadProperties: {},
      lastMessage: { id: '1', from: `https://x/contacts/8:live:p${i}`, imdisplayname: `Person ${i}`, content: 'hi', composetime: '2026-11-01T00:00:00Z' },
    }));
  const pages = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/conversations')) {
      const page = Number(u.searchParams.get('page') || 0);
      pages.push(page);
      const list = chats.slice(page * 100, page * 100 + 100);
      const backwardLink = (page + 1) * 100 < chats.length ? `https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations?page=${page + 1}` : undefined;
      return Response.json({ conversations: list, _metadata: { backwardLink } });
    }
    if (u.pathname.includes('/contacts')) return Response.json({ contacts: [] });
    return Response.json({});
  };
  const store = new Map();
  const chatIndex = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const client = createTeamsClient(async () => ({ token: jwt, expiresAt: Date.now() + 3600e3 }), { chatIndex });
  return { client, pages, store, restore: () => { globalThis.fetch = realFetch; } };
}
const titles = (r) => r.chats.map((c) => c.title);

test('list_chats pages through older chats with offset, fetching each page once', async () => {
  const t = fakeTeams();
  try {
    assert.equal((await t.client.listChats({ limit: 30 })).length, 30);
    assert.deepEqual(t.pages, [0]);
    const older = await t.client.listChats({ limit: 100, offset: 200 });
    assert.deepEqual(older.map((c) => c.title).slice(0, 2), ['Group 200', 'Person 201']);
    assert.equal(older.length, 50, 'the last 50 of 250');
    assert.deepEqual(t.pages, [0, 1, 2], 'page 0 was not fetched again');
  } finally { t.restore(); }
});

test('find_chat reads older chats only when nothing matches, and remembers them', async () => {
  const t = fakeTeams();
  try {
    const recent = await t.client.findChats('Person 7');
    assert.deepEqual(titles(recent), ['Person 7', 'Person 71', 'Person 72', 'Person 73', 'Person 74', 'Person 76', 'Person 77', 'Person 78', 'Person 79']);
    assert.deepEqual(t.pages, [0], 'found in the newest chats: no older pages read');
    assert.deepEqual({ searched: recent.searched, allSearched: recent.allSearched }, { searched: 100, allSearched: false });

    const old = await t.client.findChats('Group 240');
    assert.deepEqual(titles(old), ['Group 240']);
    assert.deepEqual(t.pages, [0, 1, 2]);
    assert.equal(old.allSearched, true);
    assert.deepEqual(Object.keys(old.chats[0]).sort(), ['id', 'lastActive', 'title', 'type'], 'compact results');

    assert.deepEqual(titles(await t.client.findChats('Group 245')), ['Group 245'], 'from the index');
    assert.deepEqual(t.pages, [0, 1, 2], 'no page read again');
    const saved = JSON.parse([...t.store.values()][0]);
    assert.equal(saved.chats.length, 250, 'the index is kept beyond the process (Cache API on the Worker)');
    assert.deepEqual(await t.client.findChats('nobody'), { chats: [], total: 0, searched: 250, allSearched: true });
  } finally { t.restore(); }
});

test('with thousands of chats, one search reads at most 10 pages and the next one goes on from there', async () => {
  const t = fakeTeams(1500);
  try {
    const first = await t.client.findChats('Group 1495');
    assert.deepEqual(first, { chats: [], total: 0, searched: 1100, allSearched: false });
    assert.equal(t.pages.length, 11, 'the newest page and 10 older ones');
    const second = await t.client.findChats('Group 1495');
    assert.deepEqual(titles(second), ['Group 1495']);
    assert.equal(second.allSearched, true);
    assert.deepEqual(t.pages.slice(11), [11, 12, 13, 14], 'only the pages not read yet');
  } finally { t.restore(); }
});

test('type limits list and find to group chats or 1:1 chats', async () => {
  const t = fakeTeams();
  try {
    const groups = await t.client.listChats({ limit: 30, type: 'group' });
    assert.equal(groups.length, 30, 'enough groups, read from older pages');
    assert.ok(groups.every((c) => c.type === 'group'));
    const oneToOne = await t.client.listChats({ limit: 10, type: 'chat' });
    assert.ok(oneToOne.length === 10 && oneToOne.every((c) => c.type === 'one-on-one'));

    // "1" matches both groups ("Group 10") and people ("Person 1").
    const g = await t.client.findChats('1', { type: 'group' });
    assert.ok(g.chats.length && g.chats.every((c) => c.type === 'group'));
    const p = await t.client.findChats('1', { type: 'chat' });
    assert.ok(p.chats.length && p.chats.every((c) => c.type === 'one-on-one'));
    assert.deepEqual((await t.client.findChats('Group 5', { type: 'chat' })).chats, [], 'groups are not searched');
    await assert.rejects(t.client.listChats({ type: 'channel' }), /Use "group" or "chat"/);

    // Few tokens for broad queries: the newest matches, and how many there are.
    const broad = await t.client.findChats('Person', { limit: 5 });
    assert.equal(broad.chats.length, 5);
    assert.equal(broad.total, 200);
  } finally { t.restore(); }
});
