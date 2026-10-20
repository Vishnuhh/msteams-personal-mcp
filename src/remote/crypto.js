// Per-user envelope encryption for the remote server (Web Crypto; runs on Workers and Node 18+).
//
// Each user holds a random access key. The database stores only SHA-256(key) as the row id and the
// user's data encrypted with AES-256-GCM under HKDF(key). Without the user's key, a database dump
// (or the server operator) cannot recover anyone's Microsoft refresh token.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '='));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** New random secret with a readable prefix, e.g. "tpm_…" (32 random bytes). */
export function newSecret(prefix) {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `${prefix}_${toB64url(b)}`;
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(secret, salt, info) {
  const ikm = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(info) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealJson(secret, salt, info, value) {
  const key = await deriveKey(secret, salt, info);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  return `${toB64url(iv)}.${toB64url(ct)}`;
}

export async function openJson(secret, salt, info, sealed) {
  const [iv, ct] = sealed.split('.');
  const key = await deriveKey(secret, salt, info);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ct));
  return JSON.parse(dec.decode(pt));
}
