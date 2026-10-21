// Tool definitions shared by the local (stdio) and remote (Cloudflare Worker) servers.
import { z } from 'zod';
import { REACTION_EMOJIS } from './emojis.js';

export const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
export const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] });
export const wrap = (fn) => async (args) => { try { return ok(await fn(args ?? {})); } catch (e) { return fail(e); } };

const timeArg = (what) => z.string().optional().describe(
  `${what}. ISO 8601 (e.g. 2026-10-20T09:00:00+05:30) or relative: "30m", "24h", "7d".`,
);

/** Registers the Teams tools against a per-user client from createTeamsClient(). */
export function registerTeamsTools(server, client) {
  server.registerTool('teams_list_chats', {
    description: 'List recent Teams personal conversations (1:1, group, meeting) with id, title (1:1 chats show the other person\'s name), unread flag and last-message preview. Use the id with teams_get_messages.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('Max chats (default 30)') },
  }, wrap(({ limit }) => client.listChats({ limit })));

  server.registerTool('teams_find_chat', {
    description: 'Find conversations by group name or, for 1:1 chats, the other person\'s name.',
    inputSchema: { query: z.string().min(1) },
  }, wrap(({ query }) => client.findChats(query)));

  server.registerTool('teams_get_chat_members', {
    description: 'List the people in a conversation with their names and ids. Each member has a ready-to-use "mentionAs" token for @mentions in teams_send_message.',
    inputSchema: { conversationId: z.string().min(1) },
  }, wrap(({ conversationId }) => client.getChatMembers(conversationId)));

  server.registerTool('teams_get_messages', {
    description: 'Get messages from a conversation, newest first, with sender names, @mentions and reactions. ' +
      'Use since/before for date ranges, e.g. since="24h" for the last day or since="2026-10-20T00:00:00+05:30" for today.',
    inputSchema: {
      conversationId: z.string().min(1),
      limit: z.number().int().min(1).max(500).optional().describe('Max messages (default 30)'),
      since: timeArg('Only messages at or after this time'),
      before: timeArg('Only messages before this time'),
      includeSystem: z.boolean().optional().describe('Include system/control events (default false)'),
    },
  }, wrap(({ conversationId, limit, since, before, includeSystem }) => client.getMessages(conversationId, { limit, since, before, includeSystem })));

  server.registerTool('teams_get_message', {
    description: 'Get one message by id with full text, sender, reply/quote, mentions, reactions, files and links.',
    inputSchema: { conversationId: z.string().min(1), messageId: z.string().min(1) },
  }, wrap(({ conversationId, messageId }) => client.getMessage(conversationId, messageId)));

  server.registerTool('teams_search_messages', {
    description: 'Search message text across recent chats (or one chat). Every word must match; also matches sender names and shared file/link names. ' +
      'Scans recent history, so narrow with since (default "30d") or conversationId for older messages.',
    inputSchema: {
      query: z.string().min(1),
      since: timeArg('Search back to this time (default "30d")'),
      conversationId: z.string().optional().describe('Only search this chat'),
      chats: z.number().int().min(1).max(30).optional().describe('How many recent chats to scan (default 20)'),
    },
  }, wrap(({ query, since, conversationId, chats }) => client.searchMessages(query, { since, conversationId, chats })));

  server.registerTool('teams_get_shared_files', {
    description: 'Files and links shared in a chat, newest first, with who shared them and when.',
    inputSchema: {
      conversationId: z.string().min(1),
      since: timeArg('Look back to this time (default "90d")'),
    },
  }, wrap(({ conversationId, since }) => client.getSharedFiles(conversationId, { since })));

  server.registerTool('teams_get_mentions', {
    description: 'Messages where someone @mentioned the signed-in user, newest first, across recent chats.',
    inputSchema: {
      since: timeArg('Look back to this time (default "7d")'),
      chats: z.number().int().min(1).max(30).optional().describe('How many recent chats to scan (default 20)'),
    },
  }, wrap(({ since, chats }) => client.getMentions({ since, chats })));

  server.registerTool('teams_get_unread', {
    description: 'Unread conversations with the messages received after the user\'s read position (oldest first). Read-only; does not mark anything as read.',
    inputSchema: { chats: z.number().int().min(1).max(100).optional().describe('How many recent chats to check (default 50)') },
  }, wrap(({ chats }) => client.getUnread({ chats })));

  server.registerTool('teams_get_my_recent_messages', {
    description: 'Messages the signed-in user sent recently, gathered from their most recent chats, newest first.',
    inputSchema: {
      chats: z.number().int().min(1).max(30).optional().describe('How many recent chats to scan (default 15)'),
      limit: z.number().int().min(1).max(100).optional().describe('Max messages to return (default 20)'),
      since: timeArg('Only messages at or after this time'),
    },
  }, wrap(({ chats, limit, since }) => client.getMyRecentMessages({ chats, limit, since })));

  server.registerTool('teams_mark_read', {
    description: 'Mark a conversation as read, up to a given message (default: the newest message). Use after the user has reviewed the chat.',
    inputSchema: {
      conversationId: z.string().min(1),
      messageId: z.string().optional().describe('Mark read up to this message (default: newest)'),
    },
  }, wrap(({ conversationId, messageId }) => client.markRead(conversationId, { messageId })));

  server.registerTool('teams_list_reaction_emojis', {
    description: 'Reaction emojis Teams personal accepts, with their keys and typical meaning. Use to suggest a fitting reaction for a message, then teams_add_reaction.',
    inputSchema: {},
  }, wrap(async () => ({
    emojis: REACTION_EMOJIS,
    skinTones: 'Keys "yes" and "no" accept -tone1 … -tone5 (e.g. "yes-tone3").',
  })));

  server.registerTool('teams_add_reaction', {
    description: 'React to a message with an emoji, visible to everyone in the chat. Only when the user asked to react. ' +
      'emoji can be a key ("like", "heart", "1f440_eyes") or the emoji itself ("👍"). See teams_list_reaction_emojis.',
    inputSchema: {
      conversationId: z.string().min(1),
      messageId: z.string().min(1),
      emoji: z.string().min(1),
    },
  }, wrap(({ conversationId, messageId, emoji }) => client.react(conversationId, messageId, emoji)));

  server.registerTool('teams_remove_reaction', {
    description: 'Remove your own emoji reaction from a message.',
    inputSchema: {
      conversationId: z.string().min(1),
      messageId: z.string().min(1),
      emoji: z.string().min(1),
    },
  }, wrap(({ conversationId, messageId, emoji }) => client.react(conversationId, messageId, emoji, { remove: true })));

  server.registerTool('teams_send_message', {
    description: 'SEND a message to a Teams personal conversation as the signed-in user. Only call when the user explicitly asked to send this exact text. ' +
      'To @mention someone (they get notified), write @[Display Name](mri) using the "mentionAs" value from teams_get_chat_members.',
    inputSchema: {
      conversationId: z.string().min(1),
      text: z.string().min(1).describe('Plain text; blank lines become paragraphs; @[Name](mri) becomes a mention'),
    },
  }, wrap(({ conversationId, text }) => client.sendMessage(conversationId, text)));

  server.registerTool('teams_reply_to_message', {
    description: 'SEND a reply that quotes a specific message (shows as a Teams reply). Only when the user explicitly asked to reply with this text. ' +
      'Supports @[Name](mri) mentions like teams_send_message.',
    inputSchema: {
      conversationId: z.string().min(1),
      messageId: z.string().min(1).describe('The message being replied to'),
      text: z.string().min(1),
    },
  }, wrap(({ conversationId, messageId, text }) => client.replyToMessage(conversationId, messageId, text)));

  server.registerTool('teams_edit_message', {
    description: 'Edit one of the signed-in user\'s own messages, replacing its text (visible to the chat as edited). Only when the user asked. Replies keep their quote.',
    inputSchema: {
      conversationId: z.string().min(1),
      messageId: z.string().min(1),
      text: z.string().min(1).describe('New full text; @[Name](mri) mentions supported'),
    },
  }, wrap(({ conversationId, messageId, text }) => client.editMessage(conversationId, messageId, text)));

  server.registerTool('teams_delete_message', {
    description: 'Delete one of the signed-in user\'s own messages (shows as deleted in the chat). Only when the user explicitly asked.',
    inputSchema: { conversationId: z.string().min(1), messageId: z.string().min(1) },
  }, wrap(({ conversationId, messageId }) => client.deleteMessage(conversationId, messageId)));
}

const userPrompt = (text) => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

/** One-click workflows (MCP prompts), shared by both servers. */
export function registerTeamsPrompts(server) {
  server.registerPrompt('catch_me_up', {
    title: 'Catch me up on Teams',
    description: 'Unread messages and @mentions, summarized, with what needs a reply.',
  }, () => userPrompt(
    'Catch me up on my Microsoft Teams (personal). Use teams_get_unread and teams_get_mentions (since "24h").\n' +
    '1. Group by chat. For each, give a one-line summary and list anything that asks me something or needs action.\n' +
    '2. End with "Needs your reply" (most urgent first) and "FYI only".\n' +
    '3. For each item that needs a reply, suggest a short reply and a fitting reaction (from teams_list_reaction_emojis).\n' +
    'Do not send, react or mark anything as read until I confirm.',
  ));

  server.registerPrompt('draft_reply', {
    title: 'Draft a Teams reply',
    description: 'Read a chat and draft a reply in your style; sends only after you approve.',
    argsSchema: {
      chat: z.string().describe('Chat or person name, e.g. "Design crew" or "Asha"'),
      intent: z.string().optional().describe('What you want to say (optional)'),
    },
  }, ({ chat, intent }) => userPrompt(
    `Find my Teams chat "${chat}" (teams_find_chat) and read its last 30 messages (teams_get_messages).\n` +
    'Then draft a reply in my usual tone. Look at my own messages in the chat to match my style and length.\n' +
    (intent ? `What I want to say: ${intent}\n` : 'Work out what most needs a response.\n') +
    'If someone should be @mentioned, use teams_get_chat_members for the right mention token. If replying to a specific message works better, say which one.\n' +
    'Show me the draft (and a suggested reaction, if fitting). Send only after I say "send" (teams_send_message or teams_reply_to_message).',
  ));

  server.registerPrompt('daily_digest', {
    title: 'Daily Teams digest',
    description: 'What happened today: key discussions, what you said, and what is waiting on you.',
  }, () => userPrompt(
    'Give me today\'s Microsoft Teams digest. Use teams_list_chats, then teams_get_messages with since="24h" for chats active today, ' +
    'plus teams_get_my_recent_messages (since "24h") and teams_get_mentions (since "24h").\n' +
    'Sections: "Key discussions" (per chat, 1-2 lines), "Decisions & action items" (who/what), "What I said", "Waiting on me". ' +
    'Keep it under 300 words. Read-only: don\'t send or change anything.',
  ));
}
