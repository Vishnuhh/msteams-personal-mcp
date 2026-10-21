// Unit tests for the pure parts of the server: message parsing/building, reactions, time, crypto.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContent, parseReply, parseCall, parseTime, stripHtml } from '../src/core/teams.js';
import { normalizeReactionKey, REACTION_EMOJIS } from '../src/core/emojis.js';
import { selfMri } from '../src/core/oauth.js';
import { newSecret, sha256Hex, sealJson, openJson } from '../src/remote/crypto.js';

test('buildContent turns @[Name](mri) into a Teams mention and escapes text', () => {
  const { html, mentions } = buildContent('Hi @[Asha Rao](8:live:.cid.abc) & team <b>\n\nsecond');
  assert.equal(mentions.length, 1);
  assert.deepEqual(mentions[0], { '@type': 'http://schema.skype.com/Mention', itemid: '0', mri: '8:live:.cid.abc', mentionType: 'person', displayName: 'Asha Rao' });
  assert.match(html, /itemscope itemid="0">Asha Rao<\/span>/);
  assert.match(html, /&amp; team &lt;b&gt;/);
  assert.ok(html.endsWith('<p>second</p>'));
  assert.equal(buildContent('no mentions here').mentions.length, 0);
});

test('parseReply separates the quote from the reply body', () => {
  const r = parseReply('<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="123"><strong itemprop="mri" itemid="8:live:x">Asha</strong><span itemprop="time" itemid="123"></span><p itemprop="preview">Can you check?</p></blockquote><p>Done</p>');
  assert.deepEqual(r.quoted, { messageId: '123', fromId: '8:live:x', from: 'Asha', preview: 'Can you check?' });
  assert.equal(stripHtml(r.body), 'Done');
  assert.equal(parseReply('<p>plain</p>'), null);
});

test('parseCall summarises a call event', () => {
  const c = parseCall('<ended/><partlist count="2"><part identity="8:a"><displayName>Asha</displayName><duration>125</duration></part><part identity="8:b"><displayName>Ben</displayName><duration>120</duration></part></partlist>');
  assert.equal(c.status, 'ended');
  assert.equal(c.durationSeconds, 125);
  assert.deepEqual(c.participants, ['Asha', 'Ben']);
  assert.equal(c.text, '📞 Call ended · 2m 5s · Asha, Ben');
});

test('stripHtml keeps inline emoji, line structure and entities', () => {
  assert.equal(stripHtml('<p>Congrats <img itemtype="http://schema.skype.com/Emoji" alt="🎉" src="x"> team</p>'), 'Congrats 🎉 team');
  assert.equal(stripHtml('<p>a</p><p>b &amp; c</p>'), 'a\nb & c');
  assert.equal(stripHtml('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
});

test('normalizeReactionKey accepts keys, skin tones and emoji; rejects unknown', () => {
  assert.equal(normalizeReactionKey('👍'), 'like');
  assert.equal(normalizeReactionKey('❤️'), 'heart');
  assert.equal(normalizeReactionKey('Heart'), 'heart');
  assert.equal(normalizeReactionKey('yes-tone3'), 'yes-tone3');
  assert.equal(normalizeReactionKey('1f440_eyes'), '1f440_eyes');
  assert.throws(() => normalizeReactionKey('banana'));
  assert.ok(REACTION_EMOJIS.length >= 10);
});

test('parseTime handles relative and ISO times', () => {
  assert.ok(Math.abs(parseTime('24h') - (Date.now() - 86400e3)) < 1000);
  assert.ok(Math.abs(parseTime('30m') - (Date.now() - 30 * 60e3)) < 1000);
  assert.equal(parseTime('2026-10-20T00:00:00+05:30'), Date.parse('2026-10-19T18:30:00Z'));
  assert.equal(parseTime(undefined), null);
  assert.throws(() => parseTime('yesterday-ish'));
});

test('selfMri reads skypeid from a JWT payload', () => {
  const payload = Buffer.from(JSON.stringify({ skypeid: 'live:.cid.123' })).toString('base64url');
  assert.equal(selfMri(`x.${payload}.y`), '8:live:.cid.123');
  assert.equal(selfMri('not-a-jwt'), null);
});

test('remote crypto: per-user sealing round-trips and needs the right key and salt', async () => {
  const key = newSecret('tpm');
  assert.match(key, /^tpm_[A-Za-z0-9_-]{43}$/);
  assert.match(await sha256Hex(key), /^[0-9a-f]{64}$/);
  const sealed = await sealJson(key, 'salt-1', 'user-data-v1', { refreshToken: 'r', n: 1 });
  assert.deepEqual(await openJson(key, 'salt-1', 'user-data-v1', sealed), { refreshToken: 'r', n: 1 });
  await assert.rejects(openJson(newSecret('tpm'), 'salt-1', 'user-data-v1', sealed));
  await assert.rejects(openJson(key, 'salt-2', 'user-data-v1', sealed));
});
