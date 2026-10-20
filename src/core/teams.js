// Teams personal chat-service client (teams.live.com/api/chatsvc/consumer).
// Headers follow the purple-teams personal build and the Teams Free web client.
// Runs on Node 18+ and Cloudflare Workers. Each client is bound to one user's token source.
import { selfMri, USER_AGENT } from './oauth.js';
import { normalizeReactionKey, describeReaction } from './emojis.js';

const CHATSVC_ROOT = 'https://teams.live.com/api/chatsvc/consumer/v1';
const CHATSVC = `${CHATSVC_ROOT}/users/ME`;
const CONTACTS = 'https://contacts.skype.com/contacts/v2/users';
const TARGET_TYPES = 'Passport|Skype|Lync|Thread|PSTN|Agent';
const CONTACTS_TTL_MS = 10 * 60 * 1000;
// Cloudflare Workers Free allows 50 outgoing requests per call; keep name lookups well under that.
const MAX_TITLE_LOOKUPS = 20;

// Module-level caches survive across requests in the same process / Worker isolate.
const contactsCache = new Map(); // selfMri -> { at, names: Map<mri, displayName> }
// "<selfMri>|<1:1 conversationId>" -> other member's mri. Keyed per user: on the shared server both
// people in a 1:1 chat may be users, and each must see the *other* person.
const partnerCache = new Map();

export function stripHtml(html = '') {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mriFromUrl = (u = '') => decodeURIComponent(u.split('/contacts/').pop() || u);
// Raw ids, or Skype ids used as a placeholder name ("live:.cid.…") when a contact has no display name.
const looksLikeId = (s) => /^((19|8|48|28):|live:)/.test(s);
const isIdLike = (title, id) => !title || title === id || looksLikeId(title);

function topicTitle(c) {
  return c.threadProperties?.topic ? stripHtml(c.threadProperties.topic) : null;
}

function conversationType(c) {
  if (c.id?.startsWith('48:') || c.id?.startsWith('19:stream01_')) return 'system';
  if (c.threadProperties?.threadType === 'meeting' || c.id?.includes('meeting_')) return 'meeting';
  if (c.id?.startsWith('19:uni01_')) return 'one-on-one';
  if (c.id?.startsWith('19:')) return 'group';
  return 'one-on-one';
}

function isUserMessage(m) {
  return /^(RichText|Text)/.test(m.messagetype || '') && !m.properties?.deletetime && Boolean(stripHtml(m.content));
}

function parseJsonish(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function messageTimeMs(m) {
  return Date.parse(m.originalarrivaltime || m.composetime || '') || Number(m.id) || 0;
}

/** Accepts ISO 8601, epoch ms, or relative "24h" / "7d" / "30m". */
export function parseTime(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v;
  const rel = String(v).trim().match(/^(\d+)\s*([mhd])$/i);
  if (rel) return Date.now() - Number(rel[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[rel[2].toLowerCase()];
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`Invalid time "${v}". Use ISO 8601 (2026-10-20T09:00:00+05:30) or relative like "24h", "7d".`);
  return t;
}

// consumptionhorizon is "lastReadMessageId;timestamp;clientMessageId".
function readHorizon(c) {
  const h = c.properties?.consumptionhorizon;
  return h ? Number(h.split(';')[0]) || 0 : null;
}

function isUnread(c, me) {
  const lm = c.lastMessage;
  if (!lm?.id || conversationType(c) === 'system' || mriFromUrl(lm.from) === me) return false;
  const h = readHorizon(c);
  return h === null ? null : Number(lm.id) > h;
}

function randomDigits() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return String(BigInt('0x' + hex) % 10n ** 18n);
}

/**
 * Turns "@[Display Name](8:live:…)" tokens into Teams mention markup.
 * Returns { html, mentions } where mentions is the properties.mentions array.
 */
export function buildContent(text) {
  const mentions = [];
  const re = /@\[([^\]]+)\]\(((?:8|28):[^)\s]+)\)/g;
  const paragraphs = text.split(/\n{2,}/).map((p) => {
    let out = '';
    let last = 0;
    for (const m of p.matchAll(re)) {
      out += escapeHtml(p.slice(last, m.index)).replace(/\n/g, '<br>');
      const itemid = String(mentions.length);
      mentions.push({ '@type': 'http://schema.skype.com/Mention', itemid, mri: m[2], mentionType: 'person', displayName: m[1] });
      out += `<readonly class="skipProofing" itemtype="http://schema.skype.com/Mention" contenteditable="false" spellcheck="false">` +
        `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${itemid}">${escapeHtml(m[1])}</span></readonly>`;
      last = m.index + m[0].length;
    }
    out += escapeHtml(p.slice(last)).replace(/\n/g, '<br>');
    return `<p>${out}</p>`;
  });
  return { html: paragraphs.join(''), mentions };
}

/**
 * @param {() => Promise<{token: string, region?: string|null}>} getSkypeToken
 */
export function createTeamsClient(getSkypeToken) {
  async function chatHeaders(body) {
    const { token } = await getSkypeToken();
    return {
      Authentication: `skypetoken=${token}`,
      'ms-ic3-product': 'tfl',
      'ms-ic3-additional-product': 'Sfl',
      'X-MS-Client-Consumer-Type': 'teams4life',
      BehaviorOverride: 'redirectAs404',
      Accept: 'application/json; ver=1.0;',
      Origin: 'https://teams.live.com',
      Referer: 'https://teams.live.com/',
      'User-Agent': USER_AGENT,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  async function request(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, { method, headers: await chatHeaders(body), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`Teams API ${method} ${new URL(url).pathname} failed (${res.status}): ${text.slice(0, 300)}`);
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }

  async function me() {
    const { token } = await getSkypeToken();
    return selfMri(token);
  }

  async function whoAmI() {
    const { token, region } = await getSkypeToken();
    return { mri: selfMri(token), region: region ?? null };
  }

  // ------------------------------------------------------------------ names

  /** mri -> display name from the user's contact list (cached 10 minutes). */
  async function contactNames() {
    const self = await me();
    const hit = contactsCache.get(self);
    if (hit && Date.now() - hit.at < CONTACTS_TTL_MS) return hit.names;
    const { token } = await getSkypeToken();
    const res = await fetch(`${CONTACTS}/${encodeURIComponent(self.replace(/^8:/, ''))}/contacts`, {
      headers: { 'X-Skypetoken': token, Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    const names = new Map();
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      for (const c of data.contacts || []) {
        if (c.mri && c.display_name && !looksLikeId(c.display_name)) names.set(c.mri, c.display_name);
      }
    }
    contactsCache.set(self, { at: Date.now(), names });
    return names;
  }

  async function threadMembers(conversationId) {
    const t = await request(`${CHATSVC_ROOT}/threads/${encodeURIComponent(conversationId)}?view=msnp24Equivalent`);
    return (t.members || []).filter((m) => !m.hidden).map((m) => ({ mri: m.id, role: m.role || null }));
  }

  /** Other participant of a 1:1 chat (cached; 1:1 membership never changes). */
  async function partnerOf(conversationId, self) {
    if (!conversationId.startsWith('19:')) return conversationId; // legacy 1:1 ids are the partner's mri
    const cacheKey = `${self}|${conversationId}`;
    if (partnerCache.has(cacheKey)) return partnerCache.get(cacheKey);
    const other = (await threadMembers(conversationId)).find((m) => m.mri !== self)?.mri || null;
    if (other) partnerCache.set(cacheKey, other);
    return other;
  }

  /** Fills in human titles for 1:1 chats whose title is still an id. Mutates and returns chats. */
  async function resolveTitles(chats, { max = MAX_TITLE_LOOKUPS } = {}) {
    const pending = chats.filter((c) => c.type === 'one-on-one' && isIdLike(c.title, c.id));
    if (!pending.length) return chats;
    const [self, names] = await Promise.all([me(), contactNames()]);
    await Promise.all(pending.slice(0, max).map(async (c) => {
      try {
        const other = await partnerOf(c.id, self);
        if (!other) return;
        c.withId = other;
        if (names.has(other)) { c.title = names.get(other); return; }
        // Fallback: the partner's display name from their own recent messages.
        const msgs = await request(`${CHATSVC}/conversations/${encodeURIComponent(c.id)}/messages?startTime=0&pageSize=50&view=msnp24Equivalent`);
        const theirs = (msgs.messages || []).find((m) => mriFromUrl(m.from) === other && m.imdisplayname);
        if (theirs) c.title = theirs.imdisplayname;
      } catch { /* keep id title */ }
    }));
    return chats;
  }

  async function getChatMembers(conversationId) {
    const [self, names, members] = await Promise.all([me(), contactNames(), threadMembers(conversationId)]);
    const unknown = members.filter((m) => !names.has(m.mri) && m.mri !== self);
    const seen = new Map();
    if (unknown.length) {
      const msgs = await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages?startTime=0&pageSize=100&view=msnp24Equivalent`);
      for (const m of msgs.messages || []) if (m.imdisplayname) seen.set(mriFromUrl(m.from), m.imdisplayname);
    }
    return members.map((m) => ({
      name: m.mri === self ? 'You' : names.get(m.mri) || seen.get(m.mri) || null,
      mri: m.mri,
      role: m.role,
      isMe: m.mri === self,
      mentionAs: `@[${m.mri === self ? 'You' : names.get(m.mri) || seen.get(m.mri) || m.mri}](${m.mri})`,
    }));
  }

  // ------------------------------------------------------------------ chats

  async function rawConversations(limit) {
    const data = await request(
      `${CHATSVC}/conversations?startTime=0&pageSize=${Math.min(limit, 100)}&view=msnp24Equivalent&targetType=${encodeURIComponent(TARGET_TYPES)}`,
    );
    return (data.conversations || []).slice(0, limit);
  }

  async function listChats({ limit = 30, resolveNames = true } = {}) {
    const self = await me();
    const chats = (await rawConversations(limit)).map((c) => {
      const lm = c.lastMessage;
      const lastFromOther = lm && mriFromUrl(lm.from) !== self && lm.imdisplayname;
      const type = conversationType(c);
      const title = topicTitle(c)
        || (type === 'one-on-one' && lastFromOther ? lm.imdisplayname : null)
        || (c.id === '48:notes' ? 'Notes (self chat)' : null)
        || (c.id?.startsWith('19:stream01_') ? 'System activity stream' : null)
        || c.id;
      return {
        id: c.id,
        title,
        type,
        unread: isUnread(c, self),
        readUpTo: readHorizon(c),
        lastMessage: lm?.content !== undefined ? {
          from: lm.imdisplayname || mriFromUrl(lm.from),
          isMine: mriFromUrl(lm.from) === self,
          time: lm.composetime || lm.originalarrivaltime,
          text: stripHtml(lm.content).slice(0, 200),
        } : null,
      };
    });
    return resolveNames ? resolveTitles(chats) : chats;
  }

  async function findChats(query, { limit = 100 } = {}) {
    const q = query.toLowerCase();
    const chats = await listChats({ limit, resolveNames: false });
    // Resolve names first so 1:1 chats can be found by the person's name.
    await resolveTitles(chats, { max: MAX_TITLE_LOOKUPS });
    return chats.filter((c) => c.title?.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }

  // ------------------------------------------------------------------ messages

  function formatMessage(m, self, names) {
    const from = mriFromUrl(m.from);
    const out = {
      id: m.id,
      conversationId: m.conversationid ?? mriFromUrl(m.conversationLink),
      from: m.imdisplayname || names?.get(from) || from,
      fromId: from,
      isMine: Boolean(self && from === self),
      time: m.originalarrivaltime || m.composetime,
      text: stripHtml(m.content),
    };
    if (/itemtype="http:\/\/schema\.skype\.com\/Reply"/.test(m.content || '')) out.isReply = true;
    const mentions = parseJsonish(m.properties?.mentions);
    if (Array.isArray(mentions) && mentions.length) {
      out.mentions = mentions.map((x) => ({ name: x.displayName || names?.get(x.mri) || x.mri, mri: x.mri, isMe: x.mri === self }));
    }
    const emotions = parseJsonish(m.properties?.emotions);
    if (Array.isArray(emotions) && emotions.length) {
      out.reactions = emotions.filter((e) => e.users?.length).map((e) => ({
        key: e.key,
        emoji: describeReaction(e.key),
        count: e.users.length,
        by: e.users.map((u) => (u.mri === self ? 'You' : names?.get(u.mri) || u.mri)),
        mine: e.users.some((u) => u.mri === self),
      }));
      if (!out.reactions.length) delete out.reactions;
    }
    return out;
  }

  async function rawMessages(conversationId, { limit = 30, since = null, before = null, includeSystem = false } = {}) {
    const out = [];
    let url = `${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages?startTime=0&pageSize=${Math.min(Math.max(limit, 50), 200)}&view=msnp24Equivalent&targetType=${encodeURIComponent(TARGET_TYPES)}`;
    // Newest first. Follow backwardLink (may point at msgapi.teams.live.com) until enough or older than `since`.
    for (let page = 0; url && out.length < limit && page < 5; page++) {
      const data = await request(url);
      let reachedSince = false;
      for (const m of data.messages || []) {
        const t = messageTimeMs(m);
        if (since !== null && t < since) { reachedSince = true; break; }
        if (before !== null && t >= before) continue;
        if (includeSystem || isUserMessage(m)) out.push(m);
        if (out.length >= limit) break;
      }
      url = reachedSince ? null : data._metadata?.backwardLink || null;
    }
    return out;
  }

  async function getMessages(conversationId, { limit = 30, includeSystem = false, since, before } = {}) {
    const [self, names] = await Promise.all([me(), contactNames().catch(() => new Map())]);
    const msgs = await rawMessages(conversationId, { limit, includeSystem, since: parseTime(since), before: parseTime(before) });
    return msgs.map((m) => formatMessage(m, self, names));
  }

  /** Unread chats with the messages that arrived after the user's read position (oldest first). */
  async function getUnread({ chats = 50, perChat = 20, maxChats = 15 } = {}) {
    const unread = (await listChats({ limit: chats, resolveNames: false })).filter((c) => c.unread).slice(0, maxChats);
    await resolveTitles(unread, { max: 10 });
    return Promise.all(unread.map(async (c) => {
      const msgs = await getMessages(c.id, { limit: perChat }).catch(() => []);
      const fresh = msgs.filter((m) => !m.isMine && Number(m.id) > (c.readUpTo ?? 0));
      return { id: c.id, title: c.title, type: c.type, unreadCount: fresh.length, messages: fresh.reverse() };
    }));
  }

  /** Messages the signed-in user sent recently, across their most recent chats. */
  async function getMyRecentMessages({ chats = 15, perChat = 30, limit = 20, since } = {}) {
    const recent = (await listChats({ limit: chats, resolveNames: false })).filter((c) => c.type !== 'system' || c.id === '48:notes');
    await resolveTitles(recent, { max: 10 });
    const lists = await Promise.all(recent.map(async (c) => {
      const msgs = await getMessages(c.id, { limit: perChat, since }).catch(() => []);
      return msgs.filter((m) => m.isMine).map((m) => ({ ...m, chat: c.title }));
    }));
    return lists.flat().sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, limit);
  }

  // ------------------------------------------------------------------ actions

  async function sendMessage(conversationId, text, { displayName } = {}) {
    const { html, mentions } = buildContent(text);
    const clientmessageid = randomDigits();
    const body = { clientmessageid, content: html, messagetype: 'RichText/Html', contenttype: 'text', imdisplayname: displayName || '' };
    if (mentions.length) body.properties = { mentions: JSON.stringify(mentions) };
    const res = await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body });
    return {
      sent: true,
      clientmessageid,
      mentioned: mentions.map((m) => m.displayName),
      arrivalTime: res.OriginalArrivalTime ?? null,
    };
  }

  async function react(conversationId, messageId, emoji, { remove = false } = {}) {
    const key = normalizeReactionKey(emoji);
    await request(
      `${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/properties?name=emotions`,
      { method: remove ? 'DELETE' : 'PUT', body: { emotions: remove ? { key } : { key, value: Date.now() } } },
    );
    return { [remove ? 'removed' : 'added']: true, key, emoji: describeReaction(key), conversationId, messageId };
  }

  /** Marks a conversation read up to messageId (default: its newest message). */
  async function markRead(conversationId, { messageId } = {}) {
    const msgs = await rawMessages(conversationId, { limit: messageId ? 200 : 1, includeSystem: true });
    const target = messageId ? msgs.find((m) => String(m.id) === String(messageId)) : msgs[0];
    if (!target) throw new Error(messageId ? `Message ${messageId} not found in the last 200 messages.` : 'Conversation has no messages.');
    const horizon = `${target.id};${messageTimeMs(target)};${target.clientmessageid || target.id}`;
    await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/properties?name=consumptionhorizon`, {
      method: 'PUT',
      body: { consumptionhorizon: horizon },
    });
    return { markedRead: true, conversationId, upToMessageId: target.id, time: target.originalarrivaltime || target.composetime };
  }

  return {
    whoAmI, listChats, findChats, getChatMembers, getMessages, getUnread, getMyRecentMessages,
    sendMessage, react, markRead,
  };
}
