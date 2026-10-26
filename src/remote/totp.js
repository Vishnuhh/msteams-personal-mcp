// Time-based one-time codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as used by authenticator apps.
// Web Crypto only, so it runs on Workers and Node.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export async function totpCode(secret, step) {
  const key = await crypto.subtle.importKey('raw', fromBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let c = step;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** The matching 30-second step (one step of clock drift either way), or null. */
export async function totpStep(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || '').trim())) return null;
  const step = Math.floor(now / 30_000);
  for (const s of [step, step - 1, step + 1]) if ((await totpCode(secret, s)) === String(code).trim()) return s;
  return null;
}

export const otpauthUri = (secret, label, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
