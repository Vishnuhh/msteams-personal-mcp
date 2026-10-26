import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContent, createTeamsClient } from '../src/core/teams.js';

const GROUP = '19:abc123@thread.v2';
const DM = '19:uni01_pairid@thread.v2';
const SELF = '8:live:me';
const KANI = '8:live:kani';

test('@Everyone uses Teams\' own group mention, only when asked for', () => {
  const on = buildContent('@[Everyone](everyone) please review', { everyone: GROUP });
  assert.deepEqual(on.mentions, [{ '@type': 'http://schema.skype.com/Mention', itemid: '0', mri: GROUP, mentionType: 'everyone', displayName: 'Everyone' }]);
  assert.match(on.html, /<span itemtype="http:\/\/schema.skype.com\/Mention" itemscope itemid="0">Everyone<\/span>/);

  const off = buildContent('@[Everyone](everyone) please review');
  assert.equal(off.mentions.length, 0, 'message text alone cannot notify a whole group');
  assert.match(off.html, /@\[Everyone\]\(everyone\)/);
  assert.equal(buildContent('@[All](19:abc123@thread.v2) hi').mentions.length, 0, 'a chat id is never a person mention');
});

/** A fake Teams: a group and a 1:1 chat with Kani; records what would be posted. */
function fakeTeams() {
  const posted = [];
  const jwt = `x.${Buffer.from(JSON.stringify({ skypeid: 'live:me' })).toString('base64url')}.y`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (init.method === 'POST' && u.includes('/messages')) { posted.push({ url: u, body: JSON.parse(init.body) }); return Response.json({ OriginalArrivalTime: 1 }); }
    if (u.includes('/threads/')) return Response.json({ members: [{ id: SELF }, { id: KANI }] });
    if (u.includes('/contacts')) return Response.json({ contacts: [{ mri: KANI, display_name: 'Kani K' }] });
    if (u.includes('/conversations?')) return Response.json({ conversations: [] });
    return Response.json({});
  };
  const client = createTeamsClient(async () => ({ token: jwt, expiresAt: Date.now() + 3600e3 }));
  return { client, posted, restore: () => { globalThis.fetch = realFetch; } };
}

test('1:1 chats: the other person\'s name becomes a real @mention', async () => {
  const t = fakeTeams();
  try {
    const r = await t.client.sendMessage(DM, 'Hi Kani, the build is ready.', { displayName: 'Me' });
    assert.deepEqual(r.mentioned, ['Kani']);
    const sent = t.posted[0].body;
    assert.match(sent.content, /Hi <readonly[^>]*><span [^>]*itemid="0">Kani<\/span><\/readonly>, the build is ready\./);
    assert.equal(JSON.parse(sent.properties.mentions)[0].mri, KANI);

    await t.client.sendMessage(DM, 'Thanks Kanimozhi and Kani!', { displayName: 'Me' });
    assert.equal(JSON.parse(t.posted[1].body.properties.mentions).length, 1, 'only the first whole-word match');
    assert.match(t.posted[1].body.content, /Kanimozhi and <readonly/, 'part of a longer name is not matched');

    await t.client.sendMessage(DM, 'Hi Kani', { displayName: 'Me', mentionRecipient: false });
    assert.equal(t.posted[2].body.properties, undefined, 'can be switched off');
  } finally { t.restore(); }
});

test('mentionEveryone: one @Everyone in groups, refused in 1:1 chats', async () => {
  const t = fakeTeams();
  try {
    await t.client.sendMessage(GROUP, 'Standup in 5 minutes', { displayName: 'Me', mentionEveryone: true });
    const m = JSON.parse(t.posted[0].body.properties.mentions);
    assert.deepEqual(m.map((x) => [x.mentionType, x.mri, x.displayName]), [['everyone', GROUP, 'Everyone']]);
    await assert.rejects(t.client.sendMessage(DM, 'hello', { displayName: 'Me', mentionEveryone: true }), /group chats/);
    assert.equal(t.posted.length, 1, 'nothing posted for the refused one');
  } finally { t.restore(); }
});
