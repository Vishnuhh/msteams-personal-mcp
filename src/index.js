#!/usr/bin/env node
// Local MCP server (stdio) for Microsoft Teams personal accounts. Single user, tokens on this machine.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { z } from 'zod';
import { startLogin, loginState, logout, hasSavedLogin, getSkypeToken, getGraphToken } from './auth.js';
import { createTeamsClient } from './core/teams.js';
import { registerTeamsTools, registerTeamsPrompts, wrap } from './core/tools.js';
import { LIMITS, isRiskyType, extOf, mb } from './core/files.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = new McpServer({ name: 'teams-personal', version });
const client = createTeamsClient(getSkypeToken, { getGraphToken });

/** PDF text, on this machine only (the free Cloudflare plan cannot afford PDF parsing). */
async function extractPdf(bytes) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return text.map((t, i) => `--- Page ${i + 1} of ${totalPages} ---\n${t}`).join('\n\n');
}

server.registerTool('teams_login', {
  description:
    'Sign in to Microsoft Teams personal (teams.live.com) with a device code. Returns a code and URL: the USER must open ' +
    'the URL, enter the code and approve. Sign-in completes in the background; check with teams_status. ' +
    'Pass force=true to discard the saved sign-in and start over.',
  inputSchema: { force: z.boolean().optional().describe('Discard saved sign-in first') },
}, wrap(async ({ force }) => {
  if (force) logout();
  else if (hasSavedLogin()) {
    try { return { alreadySignedIn: true, ...(await client.whoAmI()) }; } catch { /* fall through to new login */ }
  }
  const l = await startLogin();
  return {
    instructions: `Open ${l.verificationUrl} and enter code ${l.userCode}, then sign in with your personal Microsoft account.`,
    userCode: l.userCode,
    verificationUrl: l.verificationUrl,
    expiresAt: new Date(l.expiresAt).toISOString(),
  };
}));

server.registerTool('teams_status', {
  description: 'Show whether Teams personal is signed in and whether a device-code sign-in is pending.',
  inputSchema: {},
}, wrap(async () => {
  const pending = loginState();
  if (!hasSavedLogin()) return { signedIn: false, pendingLogin: pending };
  try { return { signedIn: true, ...(await client.whoAmI()), pendingLogin: pending }; }
  catch (e) { return { signedIn: false, error: e.message, pendingLogin: pending }; }
}));

server.registerTool('teams_logout', {
  description: 'Delete the saved Teams personal sign-in from this machine.',
  inputSchema: {},
}, wrap(async () => { logout(); return { signedOut: true }; }));

registerTeamsTools(server, client, { extractPdf });

// Local only: save a shared file to this computer (Downloads/Teams), never overwriting an existing file.
server.registerTool('teams_download_file', {
  description: 'Save a file or picture shared in a chat to this computer, in Downloads/Teams. Get messageId and index from ' +
    `teams_get_shared_files. Up to ${mb(LIMITS.downloadBytes)}. Programs and scripts (.exe, .apk, .bat, ...) are not saved.`,
  inputSchema: {
    conversationId: z.string().min(1),
    messageId: z.string().min(1),
    index: z.number().int().min(0).max(50).optional().describe('Which attachment of the message (default 0)'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}, wrap(async ({ conversationId, messageId, index = 0 }) => {
  const f = await client.readAttachment(conversationId, messageId, index, { maxBytes: LIMITS.downloadBytes });
  const ext = f.kind === 'image' ? f.ext : extOf(f.name);
  if (isRiskyType(ext)) throw new Error(`.${ext} files are programs or scripts and are not saved automatically. Open it in Teams instead${f.openUrl ? `: ${f.openUrl}` : '.'}`);
  const dir = join(homedir(), 'Downloads', 'Teams');
  mkdirSync(dir, { recursive: true });
  const safe = basename(f.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')).slice(0, 150) || 'file';
  const stem = f.kind === 'image' && !extname(safe) ? `${safe}.${ext}` : safe;
  let path = join(dir, stem);
  for (let n = 1; existsSync(path); n++) path = join(dir, `${stem.slice(0, stem.length - extname(stem).length)} (${n})${extname(stem)}`);
  writeFileSync(path, f.bytes, { flag: 'wx' });
  return { saved: path, size: mb(f.size), openUrl: f.openUrl };
}));
registerTeamsPrompts(server);

await server.connect(new StdioServerTransport());
