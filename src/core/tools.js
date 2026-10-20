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
}
