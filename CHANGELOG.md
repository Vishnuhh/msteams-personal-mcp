# Changelog

What changed in each release. Newest first. The server shows this page at `/changelog`.

Format: every release has a `## [version] - date` heading, one summary line, and short bullets under
Added, Changed, Fixed or Security. A release cannot be deployed without its entry (`npm test` checks it).

## [0.10.0] - 2026-10-26

Read files and pictures shared in chats.

### Added
- `teams_read_file`: read a file or picture shared in a group or 1:1 chat. Word, Excel (as CSV), PowerPoint, notebooks, text, code and CSV come back as text; pictures are shown to the assistant. PDFs are read by the local server.
- `teams_get_shared_files` now lists pictures too, can filter by file type, and gives each file a reference for `teams_read_file`.
- `teams_download_file` (local server): save a shared file to Downloads/Teams. Programs and scripts are never saved.
- An optional organisation logo on the home page for self-hosted servers (`BRAND_LOGO`, `BRAND_NAME`, `BRAND_URL`).

### Security
- Files are read with your own sign-in, only from chats you are in, and nothing is copied or kept on the server. Size limits apply (15 MB to read, 100 MB to download locally).
- The sign-in page and home page now say that Claude can read files and pictures shared in your chats.

### Fixed
- The home page no longer shows the invite button to people without an invite link.

## [0.9.0] - 2026-10-21

Access for your team and invited people only.

### Security
- Only approved accounts can connect: members of the team's Teams groups, people with an invite link, and people the server owner approves.
- A sign-in that isn't allowed is refused before anything is stored; the request waits for approval, and signing in again works once approved.
- Group membership is checked with your own sign-in when you connect and once a day after; leaving the group ends your access.

### Added
- Invite links: open the link, sign in once, then add the server to your app as usual.

## [0.8.0] - 2026-10-21

Usage counted per person.

### Changed
- Usage is now counted per person: which tools are used, how often, how long they take and how much they return. Message text, chat names and contacts are never recorded.
- The home page says so under Good to know.

## [0.7.3] - 2026-10-21

Sign-in codes copy cleanly.

### Fixed
- The sign-in code is shown as one word on one line, with no space in the middle, so copy and paste works as is.

### Added
- A Copy code button next to the sign-in code; clicking the code also selects all of it.

## [0.7.2] - 2026-10-21

Better-formatted messages.

### Changed
- Messages you send, reply or edit are formatted: a visible gap between paragraphs, `- ` lines become bullet lists, and `**bold**`, `` `code` `` and links work.

### Fixed
- Links in sent messages are now clickable.
- @mentions at the start of a message no longer run into the first sentence.

## [0.7.1] - 2026-10-21

Connections remember their app and your name.

### Changed
- Each connection now records which app created it (for example Claude or Claude Code) and your Teams display name, so connections can be told apart and managed.

## [0.7.0] - 2026-10-21

Safer shared servers, fair-use limits, group chat tools and this changelog.

### Added
- Group chats: `teams_get_group_info` (members, admins, creator, pinned), `teams_get_pinned_messages` and `teams_get_message_responses` (who reacted, replied or hasn't responded).
- Group changes: `teams_create_group_chat`, `teams_rename_group`, `teams_add_group_member`, `teams_remove_group_member`, `teams_leave_group`.
- `mentionEveryone` on `teams_send_message` for groups of up to 25 people.
- `group_digest` prompt: decisions, action items and what waits on you in one group.
- `teams_logout` with `everywhere=true` ends every connection of your account.
- This changelog page at `/changelog`, generated at each deploy.

### Security
- Optional team access gate: an access code or a list of allowed accounts.
- A note in your own Teams Notes chat whenever a new connection is made.
- Connections end after 90 days without use; a nightly cleanup removes stale data.
- Tools are labelled read-only, changing or destructive, so apps ask before changes; message text is marked as untrusted.
- Option to turn off personal URLs (connectors only).
- Stricter page security: script hashes, HSTS, permissions policy.

### Changed
- Per-person limits: 120 requests a minute, 10 multi-chat searches a minute, 10 changes a minute and 200 a day.
- Short caching of chat lists, and a retry when Microsoft asks to slow down.
- The version comes from `package.json` everywhere.

## [0.6.0] - 2026-10-21

Sign in from your app: add the server as a connector, no key in any URL.

### Added
- Sign-in from Claude, Claude Code, Cursor and VS Code (MCP authorization, OAuth 2.1): add `https://<server>/mcp` as a connector and approve a code at Microsoft.
- A sign-in page for apps that names the app asking and where you return to.
- Revoking access from the app (token revocation) ends the connection, like `teams_logout`.

### Changed
- Home page cut to the point: the address to add, three how-to lines, three notes.
- Personal URLs are now the fallback for apps that can't sign in.

### Security
- PKCE required, single-use sign-in codes valid 10 minutes, exact return-address matching.
- Sign-in pages can't be embedded in other sites; stricter page security headers.
- Rate limit on the sign-in endpoints.

## [0.5.0] - 2026-10-21

Redesigned home page, search and shared files, rate limits and automated checks.

### Added
- `teams_search_messages`: search recent chats; every word must match.
- `teams_get_shared_files`: files and links shared in a chat, with who shared them.
- Per-IP rate limits on sign-in and on MCP requests.
- Automated tests and CI on every push.

### Changed
- New home page design: your sign-in code appears inside the headline.
- Remote deployment needs Node.js 22+ (Wrangler requirement).

### Fixed
- The server address in the footer no longer overflows on phones and tablets.
- Tests now run on Node 20.

### Security
- Example names in docs and tool descriptions are invented, never real people.

## [0.4.0] - 2026-10-20

Replies, editing and one-click prompts.

### Added
- `teams_reply_to_message`: reply quoting a specific message, with @mentions.
- `teams_edit_message` and `teams_delete_message` for your own messages (others' are refused).
- `teams_get_mentions`: where you were @mentioned.
- `teams_get_message`: one message with full details.
- Prompts: `catch_me_up`, `draft_reply`, `daily_digest`.

### Changed
- Messages show reply quotes, files, links, forwards, edits and calls.

### Fixed
- Emoji inside messages are kept when reading.
- Messages sent through the server carry your display name.

## [0.3.0] - 2026-10-20

Real names, mentions and reactions.

### Added
- 1:1 chats show the other person's name.
- `teams_get_chat_members` with ready-to-use @mention tokens.
- @mentions in `teams_send_message`.
- `teams_add_reaction`, `teams_remove_reaction` and `teams_list_reaction_emojis`.
- `teams_mark_read`.
- `since` / `before` date filters on messages (`24h`, `7d` or a date).

### Fixed
- On a shared server, 1:1 chat names could show the wrong person.

## [0.2.0] - 2026-10-20

First public release: run it locally or as a shared remote server.

### Added
- Remote, multi-user server on Cloudflare Workers with a sign-in page and personal MCP URLs.
- Per-user encryption: the server can't read anyone's sign-in without their URL.
- `teams_logout` to revoke your connection.

### Fixed
- Custom-domain setting in `wrangler.toml` was in the wrong place.

## [0.1.0] - 2026-10-20

First working version, local only.

### Added
- Sign-in with a Microsoft device code for personal Teams (teams.live.com).
- Tools to list chats, find a chat, read messages, see unread chats, your recent messages, and send.
