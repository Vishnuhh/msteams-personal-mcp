#!/usr/bin/env node
// Small CLI for signing in and testing outside an MCP client. Shares the local token store.
import { startLogin, waitForLogin, logout, hasSavedLogin, getSkypeToken } from './auth.js';
import { createTeamsClient } from './core/teams.js';

const client = createTeamsClient(getSkypeToken);
const [cmd, ...rest] = process.argv.slice(2);
const print = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

const commands = {
  async login() {
    const l = await startLogin();
    print(`\nOpen ${l.verificationUrl} and enter code:  ${l.userCode}\nThen sign in with your personal Microsoft account. Waiting...\n`);
    await waitForLogin();
    print({ signedIn: true, ...(await client.whoAmI()) });
  },
  async status() {
    if (!hasSavedLogin()) return print({ signedIn: false });
    print({ signedIn: true, ...(await client.whoAmI()) });
  },
  async logout() { logout(); print({ signedOut: true }); },
  async chats() { print(await client.listChats({ limit: Number(rest[0]) || 30 })); },
  async find() { print(await client.findChats(rest.join(' '))); },
  async messages() { print(await client.getMessages(rest[0], { limit: Number(rest[1]) || 30 })); },
  async mine() { print(await client.getMyRecentMessages({ limit: Number(rest[0]) || 20 })); },
  async unread() { print(await client.getUnread({ chats: Number(rest[0]) || 50 })); },
};

if (!commands[cmd]) {
  print('Usage: node src/cli.js <login|status|logout|chats [n]|find <text>|messages <conversationId> [n]|mine [n]|unread [chats]>');
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
