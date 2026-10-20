# msteams-personal-mcp

An MCP server for **Microsoft Teams personal** — the free/consumer Teams at
[teams.live.com](https://teams.live.com) that you sign in to with a personal Microsoft account
(@outlook.com, @hotmail.com, @live.com, or any personal MSA).

It lets Claude, Cursor, VS Code and other MCP clients list your chats, read messages, find
unread conversations, pull up what you sent recently and (when you ask) send messages.

> **Why this exists:** Microsoft Graph's Teams chat APIs, Claude's Microsoft 365 connector,
> Microsoft's Work IQ MCP and the other community Teams MCP servers all require a **work or school**
> (Entra ID) account. None of them work with personal Teams. This one does.

**Work/school Teams is not supported.** Use a Graph-based server for that.

---

## Contents

- [Two ways to run it](#two-ways-to-run-it)
- [Option A: run locally (stdio)](#option-a-run-locally-stdio)
- [Option B: deploy your own remote server (Cloudflare, free)](#option-b-deploy-your-own-remote-server-cloudflare-free)
- [Connecting a client to a remote server](#connecting-a-client-to-a-remote-server)
- [Tools](#tools)
- [How sign-in and security work](#how-sign-in-and-security-work)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

---

## Two ways to run it

| | Local (stdio) | Remote (HTTP) |
|---|---|---|
| Who uses it | Just you, on your computer | You and anyone you share the server with. Each person signs in with their own Teams. |
| Runs on | Your machine (Node.js 18+) | Cloudflare Workers + D1 (free plan is enough) |
| Sign-in stored | Encrypted file in your user profile | Encrypted per user in D1. The server can't decrypt it without the user's personal URL. |
| You connect with | `node src/index.js` | `https://<your-host>/mcp/<your-access-key>` |

---

## Option A: run locally (stdio)

**Requirements:** Node.js 18 or newer, and git.

```bash
git clone https://github.com/Vishnuhh/msteams-personal-mcp.git
cd msteams-personal-mcp
npm install
```

### 1. Sign in

```bash
node src/cli.js login
```

It prints a code. Open the link it shows (microsoft.com/devicelogin), enter the code and sign in
with the account you use on teams.live.com. When the terminal prints `"signedIn": true` you're done.
The sign-in is saved encrypted at `%APPDATA%\teams-personal-mcp\` (Windows) or
`~/.teams-personal-mcp/` (macOS/Linux) and refreshes automatically.

Check that it works:

```bash
node src/cli.js chats      # recent chats
node src/cli.js unread     # unread chats
node src/cli.js mine       # what you sent recently
```

### 2. Add it to your MCP client

Use the **absolute path** to `src/index.js`.

**Claude Code**

```bash
claude mcp add teams-personal -- node /absolute/path/to/msteams-personal-mcp/src/index.js
```

**Claude Desktop** (Settings → Developer → Edit Config → `claude_desktop_config.json`), **Cursor**
(`~/.cursor/mcp.json`) and most other clients:

```json
{
  "mcpServers": {
    "teams-personal": {
      "command": "node",
      "args": ["/absolute/path/to/msteams-personal-mcp/src/index.js"]
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "teams-personal": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/msteams-personal-mcp/src/index.js"]
    }
  }
}
```

Restart the client. You can also sign in from inside the client: ask it to run `teams_login`.

---

## Option B: deploy your own remote server (Cloudflare, free)

This gives you one URL to share. Everyone who opens it signs in with their **own** personal Teams
account and gets their **own** private MCP URL.

**Why Cloudflare Workers:** the free plan doesn't sleep (no cold-start timeouts), includes
HTTPS and custom domains, and D1 stores sign-ins durably. The free plan currently allows 100,000
requests a day, which is plenty for a team.

**Requirements:** a free [Cloudflare account](https://dash.cloudflare.com/sign-up), Node.js 18+, git.

### 1. Get the code

```bash
git clone https://github.com/Vishnuhh/msteams-personal-mcp.git
cd msteams-personal-mcp
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the database

```bash
npx wrangler d1 create msteams-personal-mcp
```

Copy the `database_id` it prints into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "msteams-personal-mcp"
database_id = "paste-the-id-here"
```

Then create the tables:

```bash
npm run db:migrate:remote
```

### 4. (Recommended) Set a private salt

This mixes a server-side secret into every user's encryption key. Set it **before anyone signs in**:
changing it later invalidates every existing MCP URL.

```bash
npx wrangler secret put KEY_SALT
```

Paste a long random string when prompted (for example the output of `openssl rand -base64 32`).

### 5. Deploy

```bash
npm run deploy
```

Wrangler prints your URL, for example `https://msteams-personal-mcp.<your-subdomain>.workers.dev`.
Open it in a browser and you should see the sign-in page.

### 6. (Optional) Use your own domain

Your domain must be managed by Cloudflare DNS. The free plan is fine:

1. In the Cloudflare dashboard, choose **Add a domain** and follow the steps to point your domain's
   nameservers at Cloudflare (done at your domain registrar). Wait until the domain shows as **Active**.
2. In `wrangler.toml`, uncomment and edit the route. Keep it near the top, above `[vars]`: in TOML,
   anything placed after a `[section]` header belongs to that section.

   ```toml
   routes = [
     { pattern = "teams-mcp.yourdomain.com", custom_domain = true }
   ]
   ```

3. Deploy again: `npm run deploy`. Cloudflare creates the DNS record and the HTTPS certificate
   automatically.

(Or in the dashboard: **Workers & Pages → msteams-personal-mcp → Settings → Domains & Routes →
Add → Custom domain**.)

Also set `REPO_URL` in `wrangler.toml` to your repository so the sign-in page links to it.

### 7. Share it

Send people the base URL, for example `https://teams-mcp.yourdomain.com`. Each person follows
[Connecting a client to a remote server](#connecting-a-client-to-a-remote-server).

### Updating

```bash
git pull
npm install
npm run db:migrate:remote   # only if new migrations were added
npm run deploy
```

### Test it locally first (optional)

```bash
npm run db:migrate:local
npm run dev:remote          # http://127.0.0.1:8787
```

---

## Connecting a client to a remote server

### 1. Get your personal MCP URL

1. Open the server's home page (for example `https://teams-mcp.yourdomain.com`).
2. Click **Get sign-in code**.
3. Open microsoft.com/devicelogin, enter the code, and sign in with the personal Microsoft account
   you use on teams.live.com.
4. The page shows your personal MCP URL:

   ```
   https://teams-mcp.yourdomain.com/mcp/tpm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   **Treat this URL like a password.** Anyone who has it can read and send your Teams messages.
   It is shown only once. If you lose it, sign in again to get a new one.

### 2. Add it to your client

**Claude Code**

```bash
claude mcp add --transport http teams-personal https://teams-mcp.yourdomain.com/mcp/tpm_xxx
```

Add `--scope user` to make it available in every project.

**Claude (claude.ai and the Claude desktop app):** **Settings → Connectors → Add custom connector**.
Name it `Teams Personal`, paste your MCP URL, and save. Leave the OAuth fields empty.

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "teams-personal": { "url": "https://teams-mcp.yourdomain.com/mcp/tpm_xxx" }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "teams-personal": { "type": "http", "url": "https://teams-mcp.yourdomain.com/mcp/tpm_xxx" }
  }
}
```

**Clients that support headers** can keep the key out of the URL. Use the endpoint `/mcp` and send
`Authorization: Bearer tpm_xxx`:

```bash
claude mcp add --transport http teams-personal https://teams-mcp.yourdomain.com/mcp \
  --header "Authorization: Bearer tpm_xxx"
```

**Clients that only support stdio** can bridge with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "teams-personal": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://teams-mcp.yourdomain.com/mcp/tpm_xxx"]
    }
  }
}
```

### 3. Try it

Ask your assistant things like *"Do I have unread Teams messages?"*, *"What did I last say in the
Knowledge Bytes chat?"* or *"Summarize today's messages in the DevOps group"*.

### Revoking access

Ask your assistant to run **`teams_logout`**. That deletes your sign-in from the server and the URL
stops working immediately. You can also remove the app's access in your Microsoft account at
[account.live.com/consent/Manage](https://account.live.com/consent/Manage).

---

## Tools

| Tool | What it does | Local | Remote |
|------|--------------|:-----:|:------:|
| `teams_list_chats` | Recent conversations with id, title, unread flag and last-message preview | ✓ | ✓ |
| `teams_find_chat` | Find a conversation by group name or person's name | ✓ | ✓ |
| `teams_get_messages` | Messages in a conversation, newest first | ✓ | ✓ |
| `teams_get_unread` | Unread chats and the messages after your read position (doesn't mark anything as read) | ✓ | ✓ |
| `teams_get_my_recent_messages` | What you sent recently, across your latest chats | ✓ | ✓ |
| `teams_send_message` | Send a message, only when you explicitly ask | ✓ | ✓ |
| `teams_status` | Which account is signed in | ✓ | ✓ |
| `teams_logout` | Delete the saved sign-in (remote: revokes your URL) | ✓ | ✓ |
| `teams_login` | Start device-code sign-in from inside the client | ✓ | (use the web page) |

---

## How sign-in and security work

- **Microsoft's standard device-code sign-in.** You approve access on Microsoft's own page. This
  server never sees your password, and no Azure app registration is needed.
- **Teams personal APIs.** After sign-in, the server exchanges your token for a Teams session at
  `teams.live.com` and calls the same chat service the Teams web app uses.
- **Local mode:** your refresh token is encrypted (AES-256-GCM) in your user profile with a
  machine- and user-bound key.
- **Remote mode, per-user isolation:**
  - Your personal URL contains a random 256-bit access key (`tpm_…`) that only you hold.
  - The database stores only `SHA-256(access key)` as your record id, plus your Microsoft refresh
    token encrypted with AES-256-GCM under a key derived (HKDF) from your access key and the
    server's `KEY_SALT`.
  - A database dump alone, or the person running the server, can't decrypt anyone's tokens
    without that user's URL.
  - Pending sign-in codes are sealed the same way and expire after 15 minutes.
- **Sending messages** is a separate tool, described to the AI as "only when the user explicitly
  asked". Most clients also ask you to approve each tool call.
- **Self-hosting is the most private option.** Whoever runs a server controls its code. Only use
  a shared server run by someone you trust.

---

## Limitations

- **Undocumented APIs.** Teams personal has no official API for chats. This project uses the
  endpoints the Teams web client uses. Microsoft can change them at any time, and using them may
  not be covered by Microsoft's terms of service. Use at your own risk.
- **Personal accounts only.** Work/school Teams isn't supported.
- **Text messages.** Read/send covers text and rich-text messages. Files, images, reactions,
  calls and meetings aren't supported yet.
- **1:1 chat names.** If you sent the last message in a 1:1 chat, its title may show the chat id
  instead of the other person's name.
- **Remote limits.** Cloudflare's free plan caps outgoing requests per call. The multi-chat tools
  (`teams_get_my_recent_messages`, `teams_get_unread`) therefore scan up to about 20 chats per call.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Not signed in` (local) | Run `node src/cli.js login` or ask the client to run `teams_login`. |
| `Unknown or revoked access key` (remote) | Your URL was revoked or mistyped. Sign in again on the server home page. |
| `Token refresh failed … invalid_grant` | Your Microsoft sign-in expired or was revoked. Sign in again. |
| `Teams API … failed (401)` | Session expired mid-call. Retry once; if it persists, sign in again. |
| Device code expired | Codes last 15 minutes. Start again. |
| Client can't connect to remote URL | Open `https://<host>/health`. It should return `{"ok":true}`. Check that the URL includes `/mcp/…`. |

---

## Project layout

```
src/
  core/oauth.js      Microsoft device-code sign-in and Teams token exchange (Node + Workers)
  core/teams.js      Teams personal chat-service client
  core/tools.js      MCP tool definitions shared by both servers
  index.js           Local stdio MCP server
  cli.js             Local CLI (login, chats, unread, mine, ...)
  auth.js, store.js  Local sign-in state and encrypted file store
  worker.js          Remote multi-user server (Cloudflare Worker)
  remote/crypto.js   Per-user envelope encryption (Web Crypto)
  remote/page.js     Sign-in web page
migrations/          D1 schema
wrangler.toml        Cloudflare config
```

## Credits

The Teams personal sign-in flow and endpoints were worked out from
[purple-teams](https://github.com/EionRobb/purple-teams) by Eion Robb (GPLv3). No code was copied
from it. This project is not affiliated with or endorsed by Microsoft.

## License

[MIT](LICENSE)
