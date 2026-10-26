# msteams-personal-mcp

[![CI](https://github.com/Vishnuhh/msteams-personal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Vishnuhh/msteams-personal-mcp/actions/workflows/ci.yml)

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

**Requirements:** a free [Cloudflare account](https://dash.cloudflare.com/sign-up), Node.js 22+ (Wrangler needs it), git.

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

### 7. Decide who can use it

Personal Microsoft accounts have no company domain, so the server decides access per account. Set
`ADMIN_USERNAME` and `ADMIN_PASSWORD` (secrets, password at least 12 characters), open `/admin`, then
**Access**:

- **Your Teams account.** Link it once (a sign-in code, like everyone else's). It always has access, and
  the Access page uses it to list your group chats. It is sealed under a key derived from `KEY_SALT` and
  `ADMIN_PASSWORD`, used only for that list, and changing the admin password unlinks it.
- **Teams groups.** Search your group chats and click **Add** (or paste a chat id, `19:…@thread.v2`).
  Members get in automatically. Membership is checked with the person's own sign-in when they connect
  and again once a day, so leaving the group ends their access.
- **Invite links.** For people outside your groups. Set how many uses and how many days; whoever signs
  in through the link keeps access until you remove them.
- **Waiting.** Anyone else is refused, their Microsoft sign-in is not stored, and they appear here
  with **Approve** and **Block**. Connections that existed before access was restricted keep working
  and are listed here too, until you approve or remove them.

Access is restricted by default once admin sign-in is set up; without it, the server is open to any
personal Microsoft account. You can switch between **Restricted** and **Open** on the Access page.

### 8. (Optional) Server settings

Set these as Wrangler vars or secrets (`npx wrangler secret put NAME`). All are optional.

| Setting | Effect |
|---|---|
| `ACCESS_CODE` (secret) | People must enter this team access code before they can sign in. |
| `ALLOWED_ACCOUNTS` | Comma-separated Teams ids (`8:live:.cid.…`) always let in. When access is open, only these accounts may sign in. |
| `DISABLE_PERSONAL_URLS` | `true` = connectors only: personal URLs are refused and no longer offered. |
| `NEW_CONNECTION_ALERTS` | `false` = don't post a note to the user's Teams Notes on each new connection (on by default). |
| `BRAND_LOGO`, `BRAND_NAME`, `BRAND_URL` | Your organisation's logo in the home page's top bar. Put the image in a static-assets folder (`[assets] directory = "./public"` in `wrangler.toml`), set `BRAND_LOGO` to its path (e.g. `/brand/logo.webp`), `BRAND_NAME` to its alt text and optionally `BRAND_URL` (https) to link it. |
| `ADMIN_TOKEN` (secret) | Enables `GET /admin/stats` (anonymous counts) with `Authorization: Bearer <token>`. |

Connections unused for 90 days end automatically; a nightly job (cron in `wrangler.toml`) removes stale data.

### 9. Share it

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

There are two ways to connect. **Sign in from your app** (OAuth) is the easiest and keeps every key
out of URLs; use a **personal URL** for clients that don't support MCP sign-in.

### Option 1: sign in from your app (recommended)

Add the server's MCP address, **`https://teams-mcp.yourdomain.com/mcp`**, to your app. The app opens
the server's sign-in page; press **Get sign-in code**, approve the code at microsoft.com/devicelogin
with the personal Microsoft account you use on teams.live.com, and you are sent back to the app,
connected.

**Claude (claude.ai and the Claude desktop app):** **Settings → Connectors → Add custom connector**.
Name it `Teams Personal`, enter `https://teams-mcp.yourdomain.com/mcp`, **Add**, then **Connect**.

**Claude Code**

```bash
claude mcp add --scope user --transport http teams-personal https://teams-mcp.yourdomain.com/mcp
```

Then run `/mcp` inside Claude Code, pick `teams-personal` and choose **Authenticate**.

**Cursor** (`~/.cursor/mcp.json`); Cursor shows a **Login** button for the server:

```json
{
  "mcpServers": {
    "teams-personal": { "url": "https://teams-mcp.yourdomain.com/mcp" }
  }
}
```

**VS Code** (`.vscode/mcp.json`); VS Code asks you to sign in when the server starts:

```json
{
  "servers": {
    "teams-personal": { "type": "http", "url": "https://teams-mcp.yourdomain.com/mcp" }
  }
}
```

Behind the scenes this is standard MCP authorization (OAuth 2.1): discovery from the 401 response,
dynamic client registration, authorization code with PKCE (S256). No client ID or secret to set up.

### Option 2: a personal URL (any client)

1. Open the server's home page (for example `https://teams-mcp.yourdomain.com`).
2. Click **Get sign-in code**, approve it at microsoft.com/devicelogin.
3. Copy the personal MCP URL the page shows:

   ```
   https://teams-mcp.yourdomain.com/mcp/tpm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   **Treat this URL like a password.** Anyone who has it can read and send your Teams messages.
   It is shown only once. If you lose it, sign in again to get a new one.

Use it anywhere an MCP URL goes, for example:

```bash
claude mcp add --scope user --transport http teams-personal https://teams-mcp.yourdomain.com/mcp/tpm_xxx
```

Clients that support headers can keep the key out of the URL: endpoint `/mcp` with
`Authorization: Bearer tpm_xxx`. Clients that only support stdio can bridge with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "teams-personal": { "command": "npx", "args": ["-y", "mcp-remote", "https://teams-mcp.yourdomain.com/mcp"] }
  }
}
```

(`mcp-remote` handles the OAuth sign-in for you, so the plain `/mcp` address works.)

### 3. Try it

Ask your assistant things like:

- *"Do I have unread Teams messages? Summarize what needs a reply."*
- *"Summarize the last 24 hours in the DevOps group."*
- *"Who is in the Design crew chat?"*
- *"React with a fitting emoji to Asha's last message."*
- *"Send 'Please review the PR' to DevOps and mention Ravi."*
- *"Mark the HR chat as read."*

### Revoking access

Ask your assistant to run **`teams_logout`**. That deletes your sign-in from the server and the
connection (app sign-in or personal URL) stops working immediately. Removing the connector in your
app also revokes it. You can also remove the app's access in your Microsoft account at
[account.live.com/consent/Manage](https://account.live.com/consent/Manage).

---

## Tools

| Tool | What it does | Local | Remote |
|------|--------------|:-----:|:------:|
| `teams_list_chats` | Recent conversations with id, title (1:1 chats show the person's name), unread flag and last-message preview | ✓ | ✓ |
| `teams_find_chat` | Find a conversation by group name or person's name | ✓ | ✓ |
| `teams_get_chat_members` | People in a chat, with names and a ready `@mention` token | ✓ | ✓ |
| `teams_get_messages` | Messages in a chat, newest first, with @mentions, reactions, replies (quoted message), files, links, forwards, edits and calls. `since` / `before` accept ISO dates or `30m`, `24h`, `7d` | ✓ | ✓ |
| `teams_get_message` | One message by id, with full details | ✓ | ✓ |
| `teams_get_mentions` | Messages where someone @mentioned you (default: last 7 days) | ✓ | ✓ |
| `teams_search_messages` | Search message text across recent chats or one chat (every word must match; default: last 30 days) | ✓ | ✓ |
| `teams_get_shared_files` | Files, pictures and links shared in a chat (group or 1:1), with who shared them and when; filter by type (`pdf`, `docx`, …) | ✓ | ✓ |
| `teams_read_file` | Read a shared file or picture: Word, Excel (as CSV), PowerPoint, notebooks, text, code and CSV as text; pictures are shown; PDFs on the local server. Up to 15 MB, long text cut at 40,000 characters. Read-only | ✓ | ✓ (no PDF text) |
| `teams_download_file` | Save a shared file or picture to `Downloads/Teams` on your computer (up to 100 MB; programs and scripts are not saved) | ✓ | – |
| `teams_get_unread` | Unread chats and the messages after your read position (doesn't mark anything as read) | ✓ | ✓ |
| `teams_get_my_recent_messages` | What you sent recently, across your latest chats (optional `since`) | ✓ | ✓ |
| `teams_mark_read` | Mark a chat as read (up to a message, or the newest) | ✓ | ✓ |
| `teams_list_reaction_emojis` | Reaction emojis Teams accepts, with meanings, so the assistant can suggest one | ✓ | ✓ |
| `teams_add_reaction` / `teams_remove_reaction` | React to a message (👍 ❤️ 😆 🙌 🔥 👀 ✔️ …) or remove your reaction | ✓ | ✓ |
| `teams_send_message` | Send a message, only when you explicitly ask. `@[Name](id)` becomes a real @mention | ✓ | ✓ |
| `teams_reply_to_message` | Reply quoting a specific message (shows as a Teams reply), with @mentions | ✓ | ✓ |
| `teams_edit_message` / `teams_delete_message` | Edit or delete your own messages (others' messages are refused) | ✓ | ✓ |
| `teams_get_group_info` | A group at a glance: members, admins, creator, pinned messages | ✓ | ✓ |
| `teams_get_pinned_messages` | Messages pinned in a chat | ✓ | ✓ |
| `teams_get_message_responses` | For one message: who reacted, replied, wrote since, or hasn't responded | ✓ | ✓ |
| `teams_create_group_chat` / `teams_rename_group` | Create or rename a group (asks first) | ✓ | ✓ |
| `teams_add_group_member` / `teams_remove_group_member` / `teams_leave_group` | Change group membership (asks first) | ✓ | ✓ |
| `teams_status` | Which account is signed in | ✓ | ✓ |
| `teams_logout` | Disconnect. Remote: `everywhere=true` ends every connection of your account | ✓ | ✓ |
| `teams_login` | Start device-code sign-in from inside the client | ✓ | (use the web page) |

### Prompts (one-click workflows)

Clients that support MCP prompts (Claude Code `/` menu, Claude desktop "+" menu, VS Code, …) also get:

| Prompt | What it does |
|--------|--------------|
| `catch_me_up` | Unread messages and @mentions, summarized per chat, with "Needs your reply" vs "FYI" and suggested replies/reactions. Sends nothing until you confirm. |
| `draft_reply` | Reads a chat (argument: chat or person name) and drafts a reply in your style, with mentions if needed. Sends only after you say "send". |
| `daily_digest` | Today's key discussions, decisions and action items, what you said, and what's waiting on you. Read-only. |
| `group_digest` | One group since a time: decisions, action items with owners, open questions, what waits on you. Read-only. |

---

## How sign-in and security work

- **Microsoft's standard device-code sign-in.** You approve access on Microsoft's own page. This
  server never sees your password, and no Azure app registration is needed.
- **Teams personal APIs.** After sign-in, the server exchanges your token for a Teams session at
  `teams.live.com` and calls the same chat service the Teams web app uses.
- **Files shared in chats** live in the sender's OneDrive. To read one, the server gets a short-lived
  Microsoft Graph token from the same sign-in (Microsoft pre-approves the Teams app for this, so there is
  no extra consent screen) and downloads only the file you asked for, from a chat you are in. Microsoft
  issues this access as read-write to OneDrive; the tools only read files posted in your chats, and
  nothing is copied or kept on the server. Pasted pictures come from Skype's media service with your Teams
  session. Tokens are only ever sent to Microsoft's own hosts; OneDrive's download links are fetched
  without any token.
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
  - Per-IP rate limits protect the public endpoints: 5 sign-in starts, 40 sign-in checks and 300 MCP
    requests per minute (Cloudflare rate-limit bindings in `wrangler.toml`).
  - Per-person limits: 120 requests a minute, 10 multi-chat searches a minute, 10 changes a minute and
    200 changes a day. Microsoft "slow down" responses are retried once, then explained.
  - Each new connection posts a note to the person's own Teams Notes, connections end after 90 days
    unused, and `teams_logout` with `everywhere=true` ends all of an account's connections.
  - Access per account: members of chosen Teams groups (re-checked daily), invite links, or approval.
    Refused sign-ins are dropped before anything is stored. See "Decide who can use it" above.
- **App sign-in (OAuth 2.1).** The server is its own authorization server: discovery
  (RFC 9728 / RFC 8414), dynamic client registration (RFC 7591), authorization code with PKCE S256
  only, single-use codes valid 10 minutes, exact redirect-URI matching, resource indicators
  (RFC 8707), `iss` in the redirect (RFC 9207) and token revocation (RFC 7009). The access token it
  issues is the same 256-bit per-user key, so the encryption above applies unchanged. The sign-in
  page names the requesting app and where you will be sent back, and cannot be framed.
- **Tools are labelled** read-only, changing or destructive (MCP annotations), so apps ask before
  changes, and message text is marked as content from other people, not instructions.
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
- **Text messages.** Read/send covers text and rich-text messages, @mentions and reactions. Files,
  images, calls and meetings aren't supported yet.
- **Names.** Names come from your contact list, with a fallback to names seen in the chat. Someone
  who isn't in your contacts and has never written in the chat may show as an id.
- **Remote limits.** Cloudflare's free plan caps outgoing requests per call. The multi-chat tools
  (`teams_get_my_recent_messages`, `teams_get_unread`, `teams_search_messages`, `teams_get_mentions`)
  therefore scan up to about 15–20 recent chats per call.
- **Search** scans recent history client-side (personal Teams has no search API we can use), so it
  finds messages from the last weeks rather than years back.

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

## Development

Every release is listed in [CHANGELOG.md](CHANGELOG.md), which the server also shows at `/changelog`.
To start a release: `npm run release -- <version> "summary"`, edit the drafted entry, `npm test`, commit and tag.
Tests fail if the version has no finished changelog entry.

```bash
npm test                 # unit tests (node:test)
npm run dev:remote       # remote server on http://127.0.0.1:8787 (after npm run db:migrate:local)
```

CI runs the tests, starts the local server and bundles the Worker on every push.

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
test/                Unit tests
wrangler.toml        Cloudflare config
```

## Credits

The Teams personal sign-in flow and endpoints were worked out from
[purple-teams](https://github.com/EionRobb/purple-teams) by Eion Robb (GPLv3). No code was copied
from it. This project is not affiliated with or endorsed by Microsoft.

## License

[MIT](LICENSE)
