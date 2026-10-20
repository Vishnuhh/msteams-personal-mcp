// Encrypted on-disk token store under %APPDATA%\teams-personal-mcp (or ~/.teams-personal-mcp).
// The key is derived from hostname + username, so the file is useless if copied to
// another machine/user. This is obfuscation-at-rest, not a substitute for OS keychains.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'teams-personal-mcp')
  : path.join(os.homedir(), '.teams-personal-mcp');

const STORE_FILE = path.join(CONFIG_DIR, 'tokens.enc');

function key() {
  const seed = `${os.hostname()}::${os.userInfo().username}::teams-personal-mcp`;
  return crypto.createHash('sha256').update(seed).digest();
}

export function readStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE);
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  } catch {
    return {};
  }
}

export function writeStore(obj) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  fs.writeFileSync(STORE_FILE, Buffer.concat([iv, cipher.getAuthTag(), data]), { mode: 0o600 });
}

export function clearStore() {
  fs.rmSync(STORE_FILE, { force: true });
}
