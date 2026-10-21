#!/usr/bin/env node
// Local MCP server (stdio) for Microsoft Teams personal accounts. Single user, tokens on this machine.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { startLogin, loginState, logout, hasSavedLogin, getSkypeToken } from './auth.js';
import { createTeamsClient } from './core/teams.js';
import { registerTeamsTools, registerTeamsPrompts, wrap } from './core/tools.js';

const server = new McpServer({ name: 'teams-personal', version: '0.6.0' });
const client = createTeamsClient(getSkypeToken);

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

registerTeamsTools(server, client);
registerTeamsPrompts(server);

await server.connect(new StdioServerTransport());
