// Teams personal chat-service client (teams.live.com/api/chatsvc/consumer).
// Headers follow the purple-teams personal build and the Teams Free web client.
// Runs on Node 18+ and Cloudflare Workers. Each client is bound to one user's token source.
import { selfMri, USER_AGENT } from './oauth.js';

const CHATSVC = 'https://teams.live.com/api/chatsvc/consumer/v1/users/ME';
const TARGET_TYPES = 'Passport|Skype|Lync|Thread|PSTN|Agent';

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

const mriFromUrl = (u = '') => decodeURIComponent(u.split('/contacts/').pop() || u);

function conversationTitle(c, me) {
  if (c.threadProperties?.topic) return stripHtml(c.threadProperties.topic);
  const lm = c.lastMessage;
  if (lm && mriFromUrl(lm.from) !== me && lm.imdisplayname) return lm.imdisplayname;
  if (c.id?.startsWith('48:')) return c.id === '48:notes' ? 'Notes (self chat)' : c.id;
  if (c.id?.startsWith('19:stream01_')) return 'System activity stream';
  return c.id;
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

function formatMessage(m, me) {
  const from = mriFromUrl(m.from);
  return {
    id: m.id,
    conversationId: m.conversationid ?? mriFromUrl(m.conversationLink),
    from: m.imdisplayname || from,
    fromId: from,
    isMine: Boolean(me && from === me),
    time: m.composetime || m.originalarrivaltime,
    text: stripHtml(m.content),
  };
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
 * @param {() => Promise<{token: string, region?: string|null}>} getSkypeToken
 */
export function createTeamsClient(getSkypeToken) {
  async function request(url, { method = 'GET', body } = {}) {
    const { token } = await getSkypeToken();
    const res = await fetch(url, {
      method,
      headers: {
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
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Teams API ${method} ${new URL(url).pathname} failed (${res.status}): ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }

  async function me() {
    const { token } = await getSkypeToken();
    return selfMri(token);
  }

  async function whoAmI() {
    const { token, region } = await getSkypeToken();
    return { mri: selfMri(token), region: region ?? null };
  }

  async function listChats({ limit = 30 } = {}) {
    const self = await me();
    const data = await request(
      `${CHATSVC}/conversations?startTime=0&pageSize=${Math.min(limit, 100)}&view=msnp24Equivalent&targetType=${encodeURIComponent(TARGET_TYPES)}`,
    );
    return (data.conversations || []).slice(0, limit).map((c) => ({
      id: c.id,
      title: conversationTitle(c, self),
      type: conversationType(c),
      unread: isUnread(c, self),
      readUpTo: readHorizon(c),
      lastMessage: c.lastMessage?.content !== undefined ? {
        from: c.lastMessage.imdisplayname || mriFromUrl(c.lastMessage.from),
        isMine: mriFromUrl(c.lastMessage.from) === self,
        time: c.lastMessage.composetime || c.lastMessage.originalarrivaltime,
        text: stripHtml(c.lastMessage.content).slice(0, 200),
      } : null,
    }));
  }

  async function findChats(query, { limit = 100 } = {}) {
    const q = query.toLowerCase();
    const chats = await listChats({ limit });
    return chats.filter((c) => c.title?.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }

  async function getMessages(conversationId, { limit = 30, includeSystem = false } = {}) {
    const self = await me();
    const out = [];
    let url = `${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages?startTime=0&pageSize=${Math.min(limit, 200)}&view=msnp24Equivalent&targetType=${encodeURIComponent(TARGET_TYPES)}`;
    // Newest first. Follow backwardLink (may point at msgapi.teams.live.com) until we have enough.
    for (let page = 0; url && out.length < limit && page < 5; page++) {
      const data = await request(url);
      for (const m of data.messages || []) {
        if (includeSystem || isUserMessage(m)) out.push(formatMessage(m, self));
      }
      url = data._metadata?.backwardLink || null;
    }
    return out.slice(0, limit);
  }

  /** Unread chats with the messages that arrived after the user's read position (oldest first). */
  async function getUnread({ chats = 50, perChat = 20, maxChats = 20 } = {}) {
    const unread = (await listChats({ limit: chats })).filter((c) => c.unread).slice(0, maxChats);
    return Promise.all(unread.map(async (c) => {
      const msgs = await getMessages(c.id, { limit: perChat }).catch(() => []);
      const fresh = msgs.filter((m) => !m.isMine && Number(m.id) > (c.readUpTo ?? 0));
      return { id: c.id, title: c.title, type: c.type, unreadCount: fresh.length, messages: fresh.reverse() };
    }));
  }

  /** Messages the signed-in user sent recently, across their most recent chats. */
  async function getMyRecentMessages({ chats = 15, perChat = 30, limit = 20 } = {}) {
    const recent = (await listChats({ limit: chats })).filter((c) => c.type !== 'system' || c.id === '48:notes');
    const lists = await Promise.all(recent.map(async (c) => {
      const msgs = await getMessages(c.id, { limit: perChat }).catch(() => []);
      return msgs.filter((m) => m.isMine).map((m) => ({ ...m, chat: c.title }));
    }));
    return lists.flat().sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, limit);
  }

  async function sendMessage(conversationId, text, { displayName } = {}) {
    const html = text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`)
      .join('');
    const clientmessageid = randomDigits();
    const res = await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: { clientmessageid, content: html, messagetype: 'RichText/Html', contenttype: 'text', imdisplayname: displayName || '' },
    });
    return { sent: true, clientmessageid, arrivalTime: res.OriginalArrivalTime ?? null };
  }

  return { whoAmI, listChats, findChats, getMessages, getUnread, getMyRecentMessages, sendMessage };
}
