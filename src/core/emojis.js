// Reaction keys Teams personal accepts. Every key here was seen in real reactions on teams.live.com.
// Unicode emoji use "<codepoint>_<name>" keys (e.g. "1f440_eyes"); skin tones append "-tone1".."-tone5".
export const REACTION_EMOJIS = [
  { key: 'like', emoji: '👍', meaning: 'like / agree / thumbs up' },
  { key: 'heart', emoji: '❤️', meaning: 'love / thanks / appreciation' },
  { key: 'laugh', emoji: '😆', meaning: 'funny' },
  { key: 'surprised', emoji: '😮', meaning: 'wow / surprised' },
  { key: 'sad', emoji: '😢', meaning: 'sad / sympathy' },
  { key: 'angry', emoji: '😠', meaning: 'angry / frustrated' },
  { key: 'yes', emoji: '👍', meaning: 'yes / approved (Skype-style thumbs up; supports -tone1..-tone5)' },
  { key: 'no', emoji: '👎', meaning: 'no / disagree (supports -tone1..-tone5)' },
  { key: 'handsinair', emoji: '🙌', meaning: 'celebrate / great news' },
  { key: 'fire', emoji: '🔥', meaning: 'awesome / hot' },
  { key: 'highfive', emoji: '✋', meaning: 'high five / well done' },
  { key: 'fistbump', emoji: '👊', meaning: 'fist bump / team spirit' },
  { key: '2714_heavycheckmark', emoji: '✔️', meaning: 'done / acknowledged' },
  { key: '2716_heavymultiplicationx', emoji: '✖️', meaning: 'not done / rejected' },
  { key: '1f197_squaredok', emoji: '🆗', meaning: 'OK' },
  { key: '1f440_eyes', emoji: '👀', meaning: 'looking into it / noticed' },
  { key: 'loudlycrying', emoji: '😭', meaning: 'very sad / overwhelmed' },
  { key: 'lipssealed', emoji: '🤐', meaning: 'keeping quiet' },
  { key: '1f91a_raisedbackofhand', emoji: '🤚', meaning: 'raised hand / me' },
];

const BY_KEY = new Map(REACTION_EMOJIS.map((e) => [e.key, e]));
// First entry wins, so 👍 maps to "like" (the standard Teams thumbs up), not "yes".
const BY_GLYPH = new Map();
for (const e of REACTION_EMOJIS) {
  const g = e.emoji.replace(/️/g, '');
  if (!BY_GLYPH.has(g)) BY_GLYPH.set(g, e.key);
}

/** Accepts a key ("like"), a skin-toned key ("yes-tone3") or the emoji itself ("👍"). */
export function normalizeReactionKey(input) {
  const raw = String(input).trim();
  const glyph = BY_GLYPH.get(raw.replace(/️/g, ''));
  if (glyph) return glyph;
  const key = raw.toLowerCase();
  if (BY_KEY.has(key) || BY_KEY.has(key.replace(/-tone[1-5]$/, ''))) return key;
  if (/^[0-9a-f]{4,5}(_[a-z0-9]+)+$/.test(key)) return key; // other "<codepoint>_<name>" keys, passed through
  throw new Error(`Unknown reaction "${input}". Use teams_list_reaction_emojis for valid keys.`);
}

export function describeReaction(key) {
  const base = BY_KEY.get(key) || BY_KEY.get(key.replace(/-tone[1-5]$/, ''));
  return base ? base.emoji : key;
}
