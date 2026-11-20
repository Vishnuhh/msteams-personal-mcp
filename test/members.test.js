import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamsClient } from '../src/core/teams.js';

const GROUP = '19:members@thread.v2';
const SELF = '8:live:me';

test('members who are not contacts and never posted are named from their profile, once', async () => {
  const jwt = `x.${Buffer.from(JSON.stringify({ skypeid: 'live:me' })).toString('base64url')}.y`;
  const profileReads = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/threads/')) return Response.json({ members: [{ id: SELF }, { id: '8:live:kani' }, { id: '8:live:poster' }, { id: '8:live:stranger' }, { id: '8:live:ghost' }] });
    if (u.includes('/contacts')) return Response.json({ contacts: [{ mri: '8:live:kani', display_name: 'Kani K' }] });
    if (u.includes('/messages')) return Response.json({ messages: [{ from: 'https://x/contacts/8:live:poster', imdisplayname: 'Poster P' }] });
    if (u.includes('/api/mt/beta/users/')) {
      profileReads.push(u);
      assert.equal(init.headers.Authorization, 'Bearer mt-tok');
      if (u.includes('stranger')) return Response.json({ value: { displayName: 'Stranger S', emailsInfo: [{ address: 'never@shown' }] } });
      return Response.json({ value: { displayName: '' } }); // a profile Teams won't name stays unnamed
    }
    return Response.json({});
  };
  try {
    const client = createTeamsClient(async () => ({ token: jwt, expiresAt: Date.now() + 3600e3 }), { getMtToken: async () => 'mt-tok' });
    const byMri = (list) => Object.fromEntries(list.map((m) => [m.mri, m.name]));
    const first = byMri(await client.getChatMembers(GROUP));
    assert.deepEqual(first, { [SELF]: 'You', '8:live:kani': 'Kani K', '8:live:poster': 'Poster P', '8:live:stranger': 'Stranger S', '8:live:ghost': null });
    assert.equal(profileReads.length, 2, 'only members with no contact or message name are looked up');
    assert.ok(!JSON.stringify(await client.getChatMembers(GROUP)).includes('never@shown'), 'only the name leaves the profile');
    assert.equal(profileReads.length, 3, 'a found name is remembered; only the unnamed one is tried again');

    // A host with a subrequest limit (the Worker) caps lookups per call; without the cap everyone is looked up at once.
    profileReads.length = 0;
    const capped = createTeamsClient(async () => ({ token: jwt, expiresAt: Date.now() + 3600e3 }), { getMtToken: async () => 'mt-tok', maxProfileLookups: 1 });
    await capped.getChatMembers(GROUP);
    assert.equal(profileReads.length, 1);
  } finally { globalThis.fetch = realFetch; }
});
