// Tool definitions shared by the local (stdio) and remote (Cloudflare Worker) servers.
import { z } from 'zod';

export const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
export const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] });
export const wrap = (fn) => async (args) => { try { return ok(await fn(args ?? {})); } catch (e) { return fail(e); } };

/** Registers the Teams read/send tools against a per-user client from createTeamsClient(). */
export function registerTeamsTools(server, client) {
  server.registerTool('teams_list_chats', {
    description: 'List recent Teams personal conversations (1:1, group, meeting) with id, title, unread flag and last-message preview. Use the id with teams_get_messages.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('Max chats (default 30)') },
  }, wrap(({ limit }) => client.listChats({ limit })));

  server.registerTool('teams_find_chat', {
    description: 'Find conversations whose title (group topic or other person\'s name) contains the query text.',
    inputSchema: { query: z.string().min(1) },
  }, wrap(({ query }) => client.findChats(query)));

  server.registerTool('teams_get_messages', {
    description: 'Get messages from a conversation, newest first. conversationId comes from teams_list_chats / teams_find_chat.',
    inputSchema: {
      conversationId: z.string().min(1),
      limit: z.number().int().min(1).max(500).optional().describe('Max messages (default 30)'),
      includeSystem: z.boolean().optional().describe('Include system/control events (default false)'),
    },
  }, wrap(({ conversationId, limit, includeSystem }) => client.getMessages(conversationId, { limit, includeSystem })));

  server.registerTool('teams_get_unread', {
    description: 'Unread conversations with the messages received after the user\'s read position (oldest first). Read-only; does not mark anything as read.',
    inputSchema: { chats: z.number().int().min(1).max(100).optional().describe('How many recent chats to check (default 50)') },
  }, wrap(({ chats }) => client.getUnread({ chats })));

  server.registerTool('teams_get_my_recent_messages', {
    description: 'Messages the signed-in user sent recently, gathered from their most recent chats, newest first.',
    inputSchema: {
      chats: z.number().int().min(1).max(30).optional().describe('How many recent chats to scan (default 15)'),
      limit: z.number().int().min(1).max(100).optional().describe('Max messages to return (default 20)'),
    },
  }, wrap(({ chats, limit }) => client.getMyRecentMessages({ chats, limit })));

  server.registerTool('teams_send_message', {
    description: 'SEND a message to a Teams personal conversation as the signed-in user. Only call when the user explicitly asked to send this exact text.',
    inputSchema: {
      conversationId: z.string().min(1),
      text: z.string().min(1).describe('Plain text; blank lines become paragraphs'),
    },
  }, wrap(({ conversationId, text }) => client.sendMessage(conversationId, text)));
}
