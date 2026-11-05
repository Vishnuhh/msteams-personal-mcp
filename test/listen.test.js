// The local listener: which messages become channel events, no replay on first run, no duplicates across restarts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createListener } from '../src/listen.js';

const T0 = Date.parse('2026-11-05T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** A fake Teams client: chats with messages (newest first, like the real one). `post` adds a message. */
function fakeClient() {
  const chats = {
    dm: { id: '19:uni01_dm@thread.v2', title: '19:uni01_dm@thread.v2', type: 'one-on-one', msgs: [] },
    squad: { id: '19:squad@thread.v2', title: 'Softsuave Squad', type: 'group', msgs: [] },
    other: { id: '19:other@thread.v2', title: 'Random group', type: 'group', msgs: [] },
    notes: { id: '48:notes', title: 'Notes (self chat)', type: 'system', msgs: [] },
  };
  let n = 0;
  const post = (chat, t, extra = {}) => chats[chat].msgs.unshift({ id: String(++n), from: 'Gokul', time: iso(t), text: `msg ${n}`, isMine: false, ...extra });
  const calls = { getMessages: 0 };
  const client = {
    async listChats() {
      return Object.values(chats)
        .map((c) => ({ id: c.id, title: c.title, type: c.type, lastMessage: c.msgs[0] ? { time: c.msgs[0].time } : null }))
        .sort((a, b) => (Date.parse(b.lastMessage?.time) || 0) - (Date.parse(a.lastMessage?.time) || 0));
    },
    async getMessages(id, { since }) {
      calls.getMessages++;
      return Object.values(chats).find((c) => c.id === id).msgs.filter((m) => Date.parse(m.time) >= since);
    },
  };
  return { client, post, calls, chats };
}

function setup(fake, statePath = join(mkdtempSync(join(tmpdir(), 'listen-')), 'listener.json')) {
  const sent = [];
  const listener = createListener({
    client: fake.client,
    statePath,
    watch: ['19:squad@thread.v2'],
    notify: async (e) => { sent.push(e); },
    log: () => {},
  });
  return { listener, sent, statePath };
}

test('first run starts from now: old messages are not replayed', async () => {
  const fake = fakeClient();
  fake.post('dm', T0);
  const { listener, sent } = setup(fake);
  await listener.tick();
  assert.equal(sent.length, 0);
});

test('1:1 messages, @mentions and watched groups become events; others and my own do not', async () => {
  const fake = fakeClient();
  fake.post('dm', T0);
  const { listener, sent } = setup(fake);
  await listener.tick();
  fake.post('dm', T0 + 1000);
  fake.post('squad', T0 + 2000);
  fake.post('other', T0 + 3000);
  fake.post('other', T0 + 4000, { mentions: [{ name: 'Vish', isMe: true }] });
  fake.post('squad', T0 + 5000, { isMine: true });
  fake.post('notes', T0 + 6000);
  await listener.tick();
  assert.deepEqual(sent.map((e) => e.meta.kind), ['dm', 'watched', 'mention']);
  assert.equal(sent[0].meta.chat, 'Gokul', '1:1 chat with an id title is named after the sender');
  assert.equal(sent[1].meta.chat, 'Softsuave Squad');
  for (const e of sent) for (const k of Object.keys(e.meta)) assert.match(k, /^[A-Za-z0-9_]+$/, 'meta keys must be identifiers');
});

test('no duplicates on the next tick or after a restart; unchanged chats are not read', async () => {
  const fake = fakeClient();
  fake.post('squad', T0);
  const first = setup(fake);
  await first.listener.tick();
  fake.post('squad', T0 + 1000);
  await first.listener.tick();
  assert.equal(first.sent.length, 1);
  const before = fake.calls.getMessages;
  await first.listener.tick();
  assert.equal(fake.calls.getMessages, before, 'nothing new: no message requests');
  const restarted = setup(fake, first.statePath);
  await restarted.listener.tick();
  assert.equal(restarted.sent.length, 0);
  fake.post('squad', T0 + 2000);
  await restarted.listener.tick();
  assert.deepEqual(restarted.sent.map((e) => e.content), ['msg 3']);
});

test('a long offline gap sends one notice instead of the backlog', async () => {
  const fake = fakeClient();
  fake.post('dm', T0);
  const { listener, sent } = setup(fake);
  await listener.tick();
  fake.post('dm', T0 + 2 * 3600e3);
  await listener.tick();
  assert.deepEqual(sent.map((e) => e.meta.kind), ['gap']);
  fake.post('dm', T0 + 2 * 3600e3 + 1000);
  await listener.tick();
  assert.deepEqual(sent.map((e) => e.meta.kind), ['gap', 'dm']);
});
