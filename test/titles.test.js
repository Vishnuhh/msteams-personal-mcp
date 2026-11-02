// Chat titles for 1:1 chats: few lookups per call, remembered beyond the process, and none while Microsoft throttles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamsClient } from '../src/core/teams.js';

let run = 0;
/** A fake Teams with 12 one-to-one chats whose last message is mine (so the title starts as an id). */
function fakeTeams({ threads = 'ok' } = {}) {
  const self = `live:me${++run}`; // a new account per test, so the in-memory cache starts empty
  const jwt = `x.${Buffer.from(JSON.stringify({ skypeid: self })).toString('base64url')}.y`;
  const chats = Array.from({ length: 12 }, (_, i) => ({
    id: `19:uni01_chat${run}x${i}@thread.v2`,
    threadProperties: {},
    lastMessage: { id: '1', from: `https://x/contacts/8:${self}`, content: 'hi', composetime: '2026-11-01T00:00:00Z' },
  }));
  const seen = { threads: 0, messages: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/threads/')) {
      seen.threads++;
      if (threads === 'throttle') return new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } });
      const i = Number(u.match(/x(\d+)%40/)[1]);
      return Response.json({ members: [{ id: `8:${self}` }, { id: `8:live:friend${i}` }] });
    }
    if (u.includes('/contacts')) return Response.json({ contacts: Array.from({ length: 12 }, (_, i) => ({ mri: `8:live:friend${i}`, display_name: `Friend ${i}` })) });
    if (u.includes('/conversations?')) return Response.json({ conversations: chats });
    if (u.includes('/messages')) { seen.messages++; return Response.json({ messages: [] }); }
    return Response.json({});
  };
  const store = new Map();
  const partnerStore = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const throttled = [];
  const client = (withStore = true) => createTeamsClient(async () => ({ token: jwt, expiresAt: Date.now() + 3600e3 }),
    { ...(withStore ? { partnerStore } : {}), onThrottled: (i) => throttled.push(i) });
  return { client, seen, store, throttled, restore: () => { globalThis.fetch = realFetch; } };
}

test('a chat list looks up at most 6 unknown 1:1 partners, then reuses what it learned', async () => {
  const t = fakeTeams();
  try {
    const first = await t.client().listChats({ limit: 30 });
    assert.equal(t.seen.threads, 6, 'six lookups, not twelve');
    assert.equal(first.filter((c) => c.title.startsWith('Friend')).length, 6);
    assert.equal(t.store.size, 6, 'remembered beyond this process');
    await t.client().listChats({ limit: 30 });
    assert.equal(t.seen.threads, 12, 'the next call looks up only the remaining six');
    const third = await t.client().listChats({ limit: 30 });
    assert.equal(t.seen.threads, 12, 'nothing left to look up');
    assert.equal(third.filter((c) => c.title.startsWith('Friend')).length, 12);
    assert.equal(t.seen.messages, 0, 'names came from contacts, no message reads');
  } finally { t.restore(); }
});

test('while Microsoft throttles the account, name lookups stop at once and never wait', async () => {
  const t = fakeTeams({ threads: 'throttle' });
  try {
    const started = Date.now();
    const chats = await t.client(false).listChats({ limit: 30 });
    assert.ok(Date.now() - started < 1500, 'no 2-second retry waits');
    assert.ok(t.seen.threads <= 3, `at most one batch of lookups (${t.seen.threads})`);
    assert.ok(t.throttled.every((i) => i.retrying === false));
    assert.equal(chats.length, 12, 'the list itself still comes back, with id titles');
  } finally { t.restore(); }
});
