// Teams personal chat-service client (teams.live.com/api/chatsvc/consumer).
// Headers follow the purple-teams personal build and the Teams Free web client.
// Runs on Node 18+ and Cloudflare Workers. Each client is bound to one user's token source.
import { selfMri, USER_AGENT } from './oauth.js';
import { normalizeReactionKey, describeReaction } from './emojis.js';
import { attachmentsOf, readCapped, isFileDownloadUrl, extOf, toBase64, mb, LIMITS } from './files.js';

const CHATSVC_ROOT = 'https://teams.live.com/api/chatsvc/consumer/v1';
const CHATSVC = `${CHATSVC_ROOT}/users/ME`;
const CONTACTS = 'https://contacts.skype.com/contacts/v2/users';
const TARGET_TYPES = 'Passport|Skype|Lync|Thread|PSTN|Agent';
const CONTACTS_TTL_MS = 10 * 60 * 1000;
// Cloudflare Workers Free allows 50 outgoing requests per call; keep name lookups well under that.
// Work across many chats runs a few at a time: a burst of 100+ parallel calls makes Microsoft throttle the account.
const FANOUT = 6;
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** "/users/ME/conversations/{id}/messages": which Microsoft endpoint, with ids removed (for diagnostics). */
export function apiArea(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/chatsvc\/consumer\/v1/, '')
      .split('/').map((seg) => (/%3A|:|@|^\d{5,}$/.test(seg) || seg.length > 40 ? '{id}' : seg)).join('/');
    return `${u.hostname.split('.')[0]} ${path || '/'}`;
  } catch {
    return 'unknown';
  }
}

const MAX_TITLE_LOOKUPS = 20;

// Module-level caches survive across requests in the same process / Worker isolate.
const contactsCache = new Map(); // selfMri -> { at, names: Map<mri, displayName> }
const convCache = new Map(); // `${selfMri}|${limit}` -> { at, list } (short TTL; spares Teams on bursts of tool calls)
const CONV_TTL_MS = 20 * 1000;
const selfNameCache = new Map(); // selfMri -> the user's own display name
// "<selfMri>|<1:1 conversationId>" -> other member's mri. Keyed per user: on the shared server both
// people in a 1:1 chat may be users, and each must see the *other* person.
const partnerCache = new Map();

export function stripHtml(html = '') {
  return html
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, '$1') // inline emoji images carry the emoji in alt
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
  if (m.properties?.deletetime) return false;
  if (m.messagetype === 'Event/Call') return true;
  return /^(RichText|Text)/.test(m.messagetype || '') && Boolean(stripHtml(m.content));
}

const REPLY_RE = /<blockquote[^>]*itemtype="http:\/\/schema\.skype\.com\/Reply"[^>]*>([\s\S]*?)<\/blockquote>/i;

/** Splits a reply into the quoted part and the reply body. */
export function parseReply(content = '') {
  const m = content.match(REPLY_RE);
  if (!m) return null;
  const inner = m[1];
  const quotedId = (m[0].match(/itemid="([^"]+)"/) || [])[1] || null;
  const author = inner.match(/<strong[^>]*itemid="([^"]+)"[^>]*>([\s\S]*?)<\/strong>/i);
  const preview = (inner.match(/<p[^>]*itemprop="preview"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
  return {
    quoted: { messageId: quotedId, fromId: author?.[1] || null, from: author ? stripHtml(author[2]) : null, preview: stripHtml(preview) },
    body: content.replace(REPLY_RE, ''),
  };
}

export function parseCall(content = '') {
  const tag = (name) => (content.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i')) || [])[1];
  const people = [...content.matchAll(/<part\b[\s\S]*?<\/part>/gi)].map((p) => {
    const name = (p[0].match(/<displayName>([\s\S]*?)<\/displayName>/i) || p[0].match(/<name>([\s\S]*?)<\/name>/i) || [])[1];
    const dur = Number((p[0].match(/<duration>([\d.]+)<\/duration>/i) || [])[1]);
    return { name: name ? stripHtml(name) : null, seconds: Number.isFinite(dur) ? dur : null };
  });
  const secs = Math.max(0, ...people.map((p) => p.seconds || 0));
  const status = /<ended\s*\/>/i.test(content) ? 'ended' : /<missed\s*\/>/i.test(content) ? 'missed' : (tag('callEventType') || 'call');
  const length = secs ? `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s` : null;
  return {
    status,
    durationSeconds: secs || null,
    participants: people.map((p) => p.name).filter(Boolean),
    text: `📞 Call ${status}${length ? ` · ${length}` : ''}${people.length ? ` · ${people.map((p) => p.name).filter(Boolean).join(', ')}` : ''}`,
  };
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

const LINK_RE = /https?:\/\/[^\s<>"'*`]+[^\s<>"'*`.,;:!?)\]]/g;

/** Inline formatting for plain text: `code`, **bold** and clickable links. Input is raw text; output is safe HTML. */
export function formatInline(text) {
  return text.split(/(`[^`\n]+`)/).map((part, i) => {
    if (i % 2 === 1) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    let out = '';
    let last = 0;
    for (const m of part.matchAll(LINK_RE)) {
      out += escapeHtml(part.slice(last, m.index));
      const url = escapeHtml(m[0]);
      out += `<a href="${url}" title="${url}" target="_blank" rel="noreferrer noopener" itemtype="http://schema.skype.com/HyperLink">${url}</a>`;
      last = m.index + m[0].length;
    }
    out += escapeHtml(part.slice(last));
    return out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  }).join('');
}

/**
 * Turns plain text into Teams message HTML:
 *   - "@[Display Name](8:live:…)" becomes a real @mention (returned in `mentions` for properties.mentions)
 *   - with { everyone: conversationId }, "@[Everyone](everyone)" becomes Teams' @Everyone (notifies the whole group);
 *     without it the token stays plain text, so message text alone can never notify a whole group
 *   - blank lines separate paragraphs (with a visible gap, as the Teams client does)
 *   - a paragraph whose lines all start with "- " becomes a bulleted list
 *   - `code`, **bold** and https:// links are formatted inline
 */
export function buildContent(text, { everyone = null } = {}) {
  const mentions = [];
  const re = /@\[([^\]]+)\]\(((?:8|28):[^)\s]+|everyone)\)/g;
  const line = (src) => {
    let out = '';
    let last = 0;
    for (const m of src.matchAll(re)) {
      if (m[2] === 'everyone' && !everyone) continue; // stays plain text
      out += formatInline(src.slice(last, m.index));
      const itemid = String(mentions.length);
      const all = m[2] === 'everyone';
      const name = all ? 'Everyone' : m[1];
      mentions.push(all
        ? { '@type': 'http://schema.skype.com/Mention', itemid, mri: everyone, mentionType: 'everyone', displayName: name }
        : { '@type': 'http://schema.skype.com/Mention', itemid, mri: m[2], mentionType: 'person', displayName: name });
      out += `<readonly class="skipProofing" itemtype="http://schema.skype.com/Mention" contenteditable="false" spellcheck="false">` +
        `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${itemid}">${escapeHtml(name)}</span></readonly>`;
      last = m.index + m[0].length;
    }
    return out + formatInline(src.slice(last));
  };
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/).filter((b) => b.trim()).map((b) => {
    const lines = b.split('\n');
    const isItem = (l) => /^\s*[-•]\s+/.test(l);
    const list = (items) => `<ul>${items.map((l) => `<li>${line(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every(isItem)) return list(lines);
    // A heading line directly followed by a list keeps them together.
    if (lines.length > 1 && !isItem(lines[0]) && lines.slice(1).every(isItem)) return `<p>${line(lines[0])}</p>${list(lines.slice(1))}`;
    return `<p>${lines.map(line).join('<br>')}</p>`;
  });
  // Teams renders adjacent paragraphs tight together; an empty paragraph gives the gap readers expect.
  return { html: blocks.join('<p>&nbsp;</p>'), mentions };
}

/**
 * @param {() => Promise<{token: string, region?: string|null}>} getSkypeToken
 * @param {{ onTeamsCall?: () => void, onThrottled?: () => void, getGraphToken?: () => Promise<string> }} [hooks]
 *   usage counting (remote server), and a Microsoft Graph token source for reading files shared in chats
 */
export function createTeamsClient(getSkypeToken, hooks = {}) {
  const counted = (fn) => { try { fn?.(); } catch { /* counting never breaks a call */ } };
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

  async function request(url, { method = 'GET', body, withHeaders = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      counted(hooks.onTeamsCall);
      const res = await fetch(url, { method, headers: await chatHeaders(body), body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      if (res.status === 429 || res.status === 503) {
        // Microsoft is throttling this account: honour a short Retry-After once, otherwise explain.
        const wait = Number(res.headers.get('Retry-After')) || 2;
        const retrying = attempt === 0 && wait <= 5;
        counted(() => hooks.onThrottled?.({ area: apiArea(url), status: res.status, retryAfter: wait, retrying }));
        if (attempt === 0 && wait <= 5) { await new Promise((r) => setTimeout(r, wait * 1000)); continue; }
        const err = new Error(`Teams is limiting requests for your account right now. Try again in about ${Math.max(wait, 10)} seconds.`);
        err.throttled = true;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`Teams API ${method} ${new URL(url).pathname} failed (${res.status}): ${text.slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { /* empty or non-JSON success */ }
      return withHeaders ? { data, headers: res.headers } : data;
    }
  }

  async function forgetChats() {
    const self = await me();
    for (const k of convCache.keys()) if (k.startsWith(`${self}|`)) convCache.delete(k);
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
    counted(hooks.onTeamsCall);
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

  /** The signed-in user's display name, taken from their own messages (cached). */
  async function selfName() {
    const self = await me();
    if (selfNameCache.has(self)) return selfNameCache.get(self);
    let name = null;
    for (const c of await rawConversations(50)) {
      const lm = c.lastMessage;
      if (lm && mriFromUrl(lm.from) === self && lm.imdisplayname && !looksLikeId(lm.imdisplayname)) { name = lm.imdisplayname; break; }
    }
    if (name) selfNameCache.set(self, name);
    return name || '';
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
    await mapLimit(pending.slice(0, max), FANOUT, async (c) => {
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
    });
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
    const key = `${await me()}|${limit}`;
    const hit = convCache.get(key);
    if (hit && Date.now() - hit.at < CONV_TTL_MS) return hit.list;
    const data = await request(
      `${CHATSVC}/conversations?startTime=0&pageSize=${Math.min(limit, 100)}&view=msnp24Equivalent&targetType=${encodeURIComponent(TARGET_TYPES)}`,
    );
    const list = (data.conversations || []).slice(0, limit);
    convCache.set(key, { at: Date.now(), list });
    return list;
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

  /** Every group chat the user is in, from their most recent chats (up to pages × 100), for pickers. */
  async function listGroupChats({ pages = 5 } = {}) {
    const out = [];
    let url = `${CHATSVC}/conversations?startTime=0&pageSize=100&view=msnp24Equivalent&targetType=${encodeURIComponent(TARGET_TYPES)}`;
    for (let i = 0; i < pages && url; i++) {
      const data = await request(url);
      const list = data.conversations || [];
      for (const c of list) {
        if (conversationType(c) !== 'group') continue;
        const lm = c.lastMessage;
        out.push({
          id: c.id,
          title: topicTitle(c),
          lastActive: lm?.composetime || lm?.originalarrivaltime || null,
          lastFrom: lm?.imdisplayname || null,
        });
      }
      const next = data._metadata?.backwardLink;
      url = list.length && next && /(^|\.)teams\.live\.com$/.test(new URL(next).hostname) ? next : null;
    }
    return out;
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
    const nameOf = (mri) => (mri === self ? 'You' : names?.get(mri) || mri);
    const reply = parseReply(m.content);
    const out = {
      id: m.id,
      conversationId: m.conversationid ?? mriFromUrl(m.conversationLink),
      from: m.imdisplayname || names?.get(from) || from,
      fromId: from,
      isMine: Boolean(self && from === self),
      time: m.originalarrivaltime || m.composetime,
      text: stripHtml(reply ? reply.body : m.content),
    };
    if (m.messagetype === 'Event/Call') {
      const call = parseCall(m.content);
      out.kind = 'call';
      out.text = call.text;
      out.call = { status: call.status, durationSeconds: call.durationSeconds, participants: call.participants };
    }
    if (reply) {
      const q = parseJsonish(m.properties?.qtdMsgs)?.[0];
      out.replyTo = {
        messageId: reply.quoted.messageId || q?.messageId || null,
        from: (reply.quoted.from && !looksLikeId(reply.quoted.from) ? reply.quoted.from : null)
          || nameOf(reply.quoted.fromId || q?.sender || '') || null,
        preview: reply.quoted.preview,
      };
    }
    if (m.properties?.edittime) out.edited = true;
    const fwd = parseJsonish(m.properties?.originalMessageContext);
    if (fwd?.originalSender) {
      out.forwarded = { from: nameOf(fwd.originalSender), originalTime: fwd.originalSentTime || null };
    }
    const files = parseJsonish(m.properties?.files);
    if (Array.isArray(files) && files.length) {
      // index = the attachment index teams_read_file takes (files come first, in this order).
      out.files = files.map((f, index) => ({
        name: f.fileName || f.title || null,
        type: f.fileType || f.type || null,
        index,
        url: f.fileInfo?.shareUrl || f.objectUrl || f.fileInfo?.fileUrl || f.baseUrl || null,
      }));
      out.readFiles = 'Use teams_read_file (or teams_query action "read_file") with this message id and the file index to read them.';
    }
    const links = parseJsonish(m.properties?.links);
    if (Array.isArray(links) && links.length) {
      out.links = links.map((l) => ({ url: l.url, title: l.preview?.title || null }));
    } else {
      const hrefs = [...(m.content || '').matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((x) => x[1].replace(/&amp;/g, '&'));
      if (hrefs.length) out.links = [...new Set(hrefs)].map((url) => ({ url, title: null }));
    }
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
    return mapLimit(unread, FANOUT, async (c) => {
      const msgs = await getMessages(c.id, { limit: perChat }).catch(() => []);
      const fresh = msgs.filter((m) => !m.isMine && Number(m.id) > (c.readUpTo ?? 0));
      return { id: c.id, title: c.title, type: c.type, unreadCount: fresh.length, messages: fresh.reverse() };
    });
  }

  /** Messages the signed-in user sent recently, across their most recent chats. */
  async function getMyRecentMessages({ chats = 15, perChat = 30, limit = 20, since } = {}) {
    const recent = (await listChats({ limit: chats, resolveNames: false })).filter((c) => c.type !== 'system' || c.id === '48:notes');
    await resolveTitles(recent, { max: 10 });
    const lists = await mapLimit(recent, FANOUT, async (c) => {
      const msgs = await getMessages(c.id, { limit: perChat, since }).catch(() => []);
      return msgs.filter((m) => m.isMine).map((m) => ({ ...m, chat: c.title }));
    });
    return lists.flat().sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, limit);
  }

  // ------------------------------------------------------------------ actions

  const isGroup = (id) => /^19:/.test(id) && !/^19:uni01_/.test(id) && !/^19:stream01_/.test(id);
  const isOneOnOne = (id) => /^19:uni01_/.test(id) || /^(8|28):/.test(id);

  /** Teams' @Everyone at the start of the text (group chats only). */
  function withEveryone(conversationId, text) {
    if (!isGroup(conversationId)) throw new Error('@Everyone only works in group chats. In a 1:1 chat, the other person is mentioned by name.');
    return /@\[Everyone\]\(everyone\)/i.test(text) ? text : `@[Everyone](everyone) ${text}`;
  }

  /**
   * In a 1:1 chat, the other person's name written as plain text becomes a real @mention (first occurrence;
   * full name first, then first name). Text that already has a mention is left as it is.
   */
  async function mentionPartner(conversationId, text) {
    if (!isOneOnOne(conversationId) || /@\[[^\]]+\]\((?:8|28):/.test(text)) return text;
    const self = await me();
    const partner = await partnerOf(conversationId, self).catch(() => null);
    if (!partner || partner === self) return text;
    let name = (await contactNames().catch(() => new Map())).get(partner);
    if (!name) name = (await getChatMembers(conversationId).catch(() => [])).find((m) => m.mri === partner)?.name;
    if (!name || looksLikeId(name) || /[[\]()]/.test(name)) return text;
    const candidates = [name.trim(), name.trim().split(/\s+/)[0]].filter((n, i, all) => n.length >= 3 && all.indexOf(n) === i);
    for (const n of candidates) {
      const m = text.match(new RegExp(`(^|[^\\p{L}\\p{N}@\\[])(${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}\\p{N}])`, 'iu'));
      if (m) {
        const at = m.index + m[1].length;
        return `${text.slice(0, at)}@[${m[2]}](${partner})${text.slice(at + m[2].length)}`;
      }
    }
    return text;
  }

  async function prepareText(conversationId, text, { mentionEveryone, mentionRecipient }) {
    if (mentionEveryone) text = withEveryone(conversationId, text);
    if (mentionRecipient) text = await mentionPartner(conversationId, text);
    return text;
  }

  async function sendMessage(conversationId, text, { displayName, mentionEveryone = false, mentionRecipient = true } = {}) {
    text = await prepareText(conversationId, text, { mentionEveryone, mentionRecipient });
    const { html, mentions } = buildContent(text, { everyone: mentionEveryone ? conversationId : null });
    const clientmessageid = randomDigits();
    const body = { clientmessageid, content: html, messagetype: 'RichText/Html', contenttype: 'text', imdisplayname: displayName || await selfName() };
    if (mentions.length) body.properties = { mentions: JSON.stringify(mentions) };
    const res = await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body });
    await forgetChats();
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
    await forgetChats();
    return { markedRead: true, conversationId, upToMessageId: target.id, time: target.originalarrivaltime || target.composetime };
  }

  /** One raw message by id (direct lookup, falling back to a scan of recent history). */
  async function rawMessage(conversationId, messageId) {
    try {
      const m = await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`);
      if (m?.id) return m;
    } catch { /* fall back to scanning */ }
    const recent = await rawMessages(conversationId, { limit: 500, includeSystem: true });
    const hit = recent.find((x) => String(x.id) === String(messageId));
    if (!hit) throw new Error(`Message ${messageId} not found in ${conversationId}.`);
    return hit;
  }

  async function getMessage(conversationId, messageId) {
    const [self, names, m] = await Promise.all([me(), contactNames().catch(() => new Map()), rawMessage(conversationId, messageId)]);
    return formatMessage(m, self, names);
  }

  async function replyToMessage(conversationId, messageId, text, { mentionEveryone = false, mentionRecipient = true } = {}) {
    text = await prepareText(conversationId, text, { mentionEveryone, mentionRecipient });
    const [self, names, original] = await Promise.all([me(), contactNames().catch(() => new Map()), rawMessage(conversationId, messageId)]);
    const author = mriFromUrl(original.from);
    const authorName = (original.imdisplayname && !looksLikeId(original.imdisplayname) ? original.imdisplayname : null)
      || (author === self ? await selfName() : names.get(author)) || author;
    const originalText = stripHtml(parseReply(original.content)?.body ?? original.content);
    const preview = originalText.length > 150 ? `${originalText.slice(0, 147)}…` : originalText;
    const quote = `<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="${escapeHtml(String(original.id))}">` +
      `<strong itemprop="mri" itemid="${escapeHtml(author)}">${escapeHtml(authorName)}</strong>` +
      `<span itemprop="time" itemid="${escapeHtml(String(original.id))}"></span>` +
      `<p itemprop="preview">${escapeHtml(preview)}</p></blockquote>`;
    const { html, mentions } = buildContent(text, { everyone: mentionEveryone ? conversationId : null });
    const clientmessageid = randomDigits();
    const properties = {
      qtdMsgs: JSON.stringify([{ messageId: String(original.id), sender: author, time: messageTimeMs(original) }]),
      ...(mentions.length ? { mentions: JSON.stringify(mentions) } : {}),
    };
    await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: { clientmessageid, content: quote + html, messagetype: 'RichText/Html', contenttype: 'text', imdisplayname: await selfName(), properties },
    });
    return { sent: true, repliedTo: { messageId: String(original.id), from: author === self ? 'You' : authorName }, mentioned: mentions.map((m) => m.displayName) };
  }

  async function assertMine(conversationId, messageId) {
    const [self, m] = await Promise.all([me(), rawMessage(conversationId, messageId)]);
    if (mriFromUrl(m.from) !== self) throw new Error('You can only edit or delete your own messages.');
    if (m.properties?.deletetime) throw new Error('That message is already deleted.');
    return m;
  }

  async function editMessage(conversationId, messageId, text) {
    const original = await assertMine(conversationId, messageId);
    // Keep the quote when editing a reply, so it stays a reply.
    const quote = (original.content || '').match(REPLY_RE)?.[0] || '';
    const { html, mentions } = buildContent(text);
    const body = {
      id: String(messageId), type: 'Message', conversationid: conversationId,
      content: quote + html, messagetype: 'RichText/Html', contenttype: 'text', imdisplayname: original.imdisplayname || await selfName(),
    };
    const props = {};
    if (mentions.length) props.mentions = JSON.stringify(mentions);
    if (quote && original.properties?.qtdMsgs) props.qtdMsgs = original.properties.qtdMsgs;
    if (Object.keys(props).length) body.properties = props;
    await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, { method: 'PUT', body });
    return { edited: true, conversationId, messageId: String(messageId), mentioned: mentions.map((m) => m.displayName) };
  }

  async function deleteMessage(conversationId, messageId) {
    await assertMine(conversationId, messageId);
    await request(`${CHATSVC}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}?behavior=softDelete`, { method: 'DELETE' });
    return { deleted: true, conversationId, messageId: String(messageId) };
  }

  /** Messages that @mention the signed-in user, newest first, across recent chats. */
  async function getMentions({ since = '7d', chats = 20, limit = 30 } = {}) {
    const sinceMs = parseTime(since);
    const recent = (await listChats({ limit: chats, resolveNames: false }))
      .filter((c) => c.type !== 'system' && (!c.lastMessage?.time || Date.parse(c.lastMessage.time) >= sinceMs));
    await resolveTitles(recent, { max: 8 });
    const lists = await mapLimit(recent, FANOUT, async (c) => {
      const msgs = await getMessages(c.id, { limit: 200, since: sinceMs }).catch(() => []);
      return msgs.filter((m) => !m.isMine && m.mentions?.some((x) => x.isMe)).map((m) => ({ ...m, chat: c.title }));
    });
    return lists.flat().sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, limit);
  }

  /**
   * Text search across recent chats (Teams personal has no server-side search API we can use).
   * Every word of the query must appear in the message, sender or file/link names; case-insensitive.
   */
  async function searchMessages(query, { since = '30d', chats = 20, limit = 30, conversationId } = {}) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) throw new Error('Search needs at least one word.');
    const sinceMs = parseTime(since);
    let scope;
    if (conversationId) {
      scope = [{ id: conversationId, title: null }];
    } else {
      scope = (await listChats({ limit: chats, resolveNames: false }))
        .filter((c) => c.type !== 'system' && (!c.lastMessage?.time || Date.parse(c.lastMessage.time) >= sinceMs));
      await resolveTitles(scope, { max: 8 });
    }
    const lists = await mapLimit(scope, FANOUT, async (c) => {
      const msgs = await getMessages(c.id, { limit: 200, since: sinceMs }).catch(() => []);
      return msgs.filter((m) => {
        const hay = [m.text, m.from, ...(m.files || []).map((f) => f.name), ...(m.links || []).map((l) => `${l.url} ${l.title || ''}`)]
          .join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      }).map((m) => ({ ...m, chat: c.title }));
    });
    return lists.flat().sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, limit);
  }

  /** Files, pictures and links shared in a chat, newest first. messageId + index identify each for readAttachment. */
  async function getSharedFiles(conversationId, { since = '90d', limit = 50, type = null } = {}) {
    const [self, names] = await Promise.all([me(), contactNames().catch(() => new Map())]);
    const raw = await rawMessages(conversationId, { limit: 500, since: parseTime(since) });
    const files = [], images = [], links = [];
    for (const m of raw) {
      const f = formatMessage(m, self, names);
      for (const a of attachmentsOf(m)) {
        const item = { messageId: f.id, index: a.index, name: a.name, type: a.kind === 'image' ? 'image' : a.ext || null, from: f.from, time: f.time };
        if (a.kind === 'image') images.push(item);
        else if (!type || a.ext === String(type).toLowerCase().replace(/^\./, '')) files.push(item);
      }
      for (const l of f.links || []) links.push({ ...l, from: f.from, time: f.time, messageId: f.id });
    }
    return {
      files: files.slice(0, limit),
      images: type ? [] : images.slice(0, limit),
      links: type ? [] : links.slice(0, limit),
      scannedMessages: raw.length,
    };
  }

  /**
   * One file or picture from a message (index as listed by getSharedFiles), as bytes.
   * Files come from the sharer's OneDrive through Microsoft Graph with this user's own token; the short-lived
   * download link Graph returns is fetched without any token. Pictures come from Skype's media service.
   * Returns { kind, name, ext, mimeType, size, bytes, openUrl }.
   */
  async function readAttachment(conversationId, messageId, index = 0, { maxBytes = LIMITS.readBytes } = {}) {
    const list = attachmentsOf(await rawMessage(conversationId, messageId));
    if (!list.length) throw new Error('That message has no files or pictures. Use teams_get_shared_files to find one.');
    const a = list[index];
    if (!a) throw new Error(`That message has ${list.length} attachment(s): use index 0 to ${list.length - 1}.`);

    if (a.kind === 'image') {
      const { token } = await getSkypeToken();
      counted(hooks.onTeamsCall);
      const res = await fetch(a.src, { headers: { Authorization: `skype_token ${token}`, 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`Could not open the picture (${res.status}). It may have been deleted.`);
      const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (!mimeType.startsWith('image/')) throw new Error('That attachment is not a picture.');
      const bytes = await readCapped(res, Math.min(maxBytes, LIMITS.imageBytes), 'picture');
      return { kind: 'image', name: a.name, ext: mimeType.split('/')[1] || 'jpg', mimeType, size: bytes.length, bytes, openUrl: null };
    }

    if (!hooks.getGraphToken) throw new Error('Reading shared files is not available on this server.');
    if (!a.shareUrl && !(a.driveId && a.itemId)) throw new Error('This file has no OneDrive link that can be opened.');
    const path = a.shareUrl
      ? `/shares/u!${toBase64(new TextEncoder().encode(a.shareUrl)).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}/driveItem`
      : `/drives/${encodeURIComponent(a.driveId)}/items/${encodeURIComponent(a.itemId)}`;
    const token = await hooks.getGraphToken();
    counted(hooks.onTeamsCall);
    const meta = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'redeemSharingLinkIfNecessary', 'User-Agent': USER_AGENT },
    });
    if (meta.status === 401 || meta.status === 403 || meta.status === 404) {
      throw new Error('You no longer have access to this file: it may have been deleted, moved or unshared.');
    }
    if (!meta.ok) throw new Error(`OneDrive could not open the file (${meta.status}). Try again later.`);
    const item = await meta.json();
    const name = item.name || a.name;
    const size = Number(item.size) || 0;
    if (size > maxBytes) {
      throw new Error(`The file is too large to read here (${mb(size)}; the limit is ${mb(maxBytes)}). Open it in Teams or OneDrive${item.webUrl ? `: ${item.webUrl}` : '.'}`);
    }
    const link = item['@microsoft.graph.downloadUrl'];
    if (!link || !isFileDownloadUrl(link)) throw new Error('OneDrive did not offer a download for this file.');
    counted(hooks.onTeamsCall);
    const res = await fetch(link, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`The download failed (${res.status}). Try again.`);
    const bytes = await readCapped(res, maxBytes);
    return { kind: 'file', name, ext: extOf(name), mimeType: item.file?.mimeType || null, size: bytes.length, bytes, openUrl: item.webUrl || null };
  }

  // ------------------------------------------------------------------ groups

  async function rawThread(conversationId) {
    return request(`${CHATSVC_ROOT}/threads/${encodeURIComponent(conversationId)}?view=msnp24Equivalent`);
  }

  /** Whether the signed-in user is in a group chat: { member, topic }. Teams answers 403/404 for others. */
  async function membership(conversationId) {
    let t;
    try { t = await rawThread(conversationId); } catch (e) {
      if (e.status === 403 || e.status === 404) return { member: false, topic: null };
      throw e;
    }
    const self = await me();
    return { member: Boolean(self) && (t.members || []).some((m) => m.id === self), topic: t.properties?.topic ? stripHtml(t.properties.topic) : null };
  }

  function isPinned(m) {
    const p = parseJsonish(m.properties?.pinned);
    if (!p) return false;
    if (typeof p === 'object') return p.isPinned !== false && p.pinned !== false;
    return p !== 'false' && p !== false;
  }

  /** Pinned messages found in recent history (Teams personal returns pins on the messages themselves). */
  async function getPinnedMessages(conversationId, { since = '365d' } = {}) {
    const [self, names] = await Promise.all([me(), contactNames().catch(() => new Map())]);
    const msgs = await rawMessages(conversationId, { limit: 500, since: parseTime(since) });
    return msgs.filter(isPinned).map((m) => formatMessage(m, self, names));
  }

  /** Topic, members with roles, admins, creation and pinned messages of a group chat. */
  async function getGroupInfo(conversationId) {
    const [thread, members, pinned, names, self] = await Promise.all([
      rawThread(conversationId), getChatMembers(conversationId), getPinnedMessages(conversationId).catch(() => []),
      contactNames().catch(() => new Map()), me(),
    ]);
    const props = thread.properties || {};
    const created = Number(props.createdat) || null;
    const creator = props.creator || null;
    return {
      id: conversationId,
      topic: props.topic ? stripHtml(props.topic) : null,
      type: props.threadType || null,
      createdAt: created ? new Date(created).toISOString() : null,
      createdBy: creator ? (creator === self ? 'You' : names.get(creator) || creator) : null,
      memberCount: members.length,
      admins: members.filter((m) => /admin/i.test(m.role || '')).map((m) => m.name || m.mri),
      members: members.map((m) => ({ name: m.name, mri: m.mri, role: m.role, isMe: m.isMe })),
      pinned: pinned.map((m) => ({ id: m.id, from: m.from, time: m.time, text: m.text.slice(0, 300) })),
    };
  }

  /** For one message: who reacted, who replied to it, who wrote since, and who has not responded. */
  async function getMessageResponses(conversationId, messageId) {
    const [self, names, original, members] = await Promise.all([
      me(), contactNames().catch(() => new Map()), rawMessage(conversationId, messageId), getChatMembers(conversationId),
    ]);
    const author = mriFromUrl(original.from);
    const after = (await rawMessages(conversationId, { limit: 500, since: messageTimeMs(original) + 1 }))
      .map((m) => formatMessage(m, self, names));
    const nameOf = (mri) => (mri === self ? 'You' : names.get(mri) || members.find((x) => x.mri === mri)?.name || mri);
    const reacted = new Map();
    for (const e of parseJsonish(original.properties?.emotions) || []) {
      for (const u of e.users || []) {
        const list = reacted.get(u.mri) || [];
        list.push(describeReaction(e.key));
        reacted.set(u.mri, list);
      }
    }
    const replied = new Set(after.filter((m) => m.replyTo?.messageId === String(original.id)).map((m) => m.fromId));
    const wroteSince = new Set(after.map((m) => m.fromId));
    const everyone = members.map((m) => m.mri).filter((mri) => mri !== author);
    return {
      message: {
        id: String(original.id), from: nameOf(author), time: original.originalarrivaltime || original.composetime,
        text: stripHtml(parseReply(original.content)?.body ?? original.content).slice(0, 300),
      },
      reacted: [...reacted].map(([mri, emojis]) => ({ name: nameOf(mri), reactions: emojis })),
      repliedToIt: [...replied].map(nameOf),
      wroteSince: everyone.filter((mri) => wroteSince.has(mri) && !replied.has(mri)).map(nameOf),
      noResponse: everyone.filter((mri) => !reacted.has(mri) && !replied.has(mri) && !wroteSince.has(mri)).map(nameOf),
      note: 'noResponse means no reaction, reply or message since; it does not mean they did not read it.',
    };
  }

  async function createGroupChat({ members, topic } = {}) {
    const self = await me();
    const others = [...new Set((members || []).filter((m) => m && m !== self))];
    if (!others.length) throw new Error('Add at least one other member (their id, from teams_get_chat_members or a 1:1 chat).');
    if (others.some((m) => !/^(8|28):/.test(m))) throw new Error('Members must be Teams ids like 8:live:.cid.…');
    const body = {
      members: [{ id: self, role: 'Admin' }, ...others.map((id) => ({ id, role: 'User' }))],
      properties: { threadType: 'chat', chatFilesIndexId: '2', ...(topic ? { topic: String(topic).slice(0, 200) } : {}) },
    };
    const { data, headers } = await request(`${CHATSVC_ROOT}/threads`, { method: 'POST', body, withHeaders: true });
    const id = data?.id || decodeURIComponent((headers.get('Location') || '').split('/threads/').pop() || '') || null;
    await forgetChats();
    return { created: Boolean(id), conversationId: id, topic: topic || null, members: others.length + 1 };
  }

  async function renameGroup(conversationId, topic) {
    if (!topic || !String(topic).trim()) throw new Error('Give the new group name.');
    await request(`${CHATSVC_ROOT}/threads/${encodeURIComponent(conversationId)}/properties?name=topic`, {
      method: 'PUT', body: { topic: String(topic).trim().slice(0, 200) },
    });
    await forgetChats();
    return { renamed: true, conversationId, topic: String(topic).trim() };
  }

  async function setMember(conversationId, mri, { remove = false } = {}) {
    if (!/^(8|28):/.test(mri || '')) throw new Error('Member must be a Teams id like 8:live:.cid.… (see teams_get_chat_members).');
    const url = `${CHATSVC_ROOT}/threads/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(mri)}`;
    await request(url, remove ? { method: 'DELETE' } : { method: 'PUT', body: { role: 'User' } });
    await forgetChats();
    return { [remove ? 'removed' : 'added']: true, conversationId, member: mri };
  }

  async function leaveGroup(conversationId) {
    const self = await me();
    await request(`${CHATSVC_ROOT}/threads/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(self)}`, { method: 'DELETE' });
    await forgetChats();
    return { left: true, conversationId };
  }

  return {
    displayName: selfName, membership, listGroupChats, getGroupInfo, getPinnedMessages, getMessageResponses, createGroupChat, renameGroup, setMember, leaveGroup,
    searchMessages, getSharedFiles, readAttachment,
    whoAmI, listChats, findChats, getChatMembers, getMessages, getMessage, getUnread, getMyRecentMessages, getMentions,
    sendMessage, replyToMessage, editMessage, deleteMessage, react, markRead,
  };
}
