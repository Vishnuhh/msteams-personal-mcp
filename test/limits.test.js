// Per-person limits, tested with stand-ins only: a fake rate limiter, a fake D1 and a fake Teams client.
// Nothing here talks to Teams.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolGuard } from '../src/remote/limits.js';
import { registerTeamsTools, TOOL_KINDS } from '../src/core/tools.js';

const limiter = (allow) => { let n = 0; return { limit: async () => ({ success: ++n <= allow }) }; };
function usageDb() {
  const rows = new Map();
  return {
    prepare: () => {
      let args = [];
      const s = { bind: (...a) => { args = a; return s; }, first: async () => {
        const k = `${args[0]}|${args[1]}`;
        rows.set(k, (rows.get(k) || 0) + 1);
        return { writes: rows.get(k) };
      } };
      return s;
    },
  };
}

test('heavy tools are limited per minute; reads are not', async () => {
  const guard = toolGuard({ HEAVY_LIMITER: limiter(2), DB: usageDb() }, 'u1');
  await guard('teams_search_messages', 'heavy');
  await guard('teams_search_messages', 'heavy');
  await assert.rejects(guard('teams_search_messages', 'heavy'), /Wait a minute/);
  for (let i = 0; i < 20; i++) await guard('teams_get_messages', 'read');
});

test('writes are limited per minute and per day', async () => {
  const guard = toolGuard({ WRITE_LIMITER: limiter(3), DB: usageDb() }, 'u1');
  for (let i = 0; i < 3; i++) await guard('teams_send_message', 'write');
  await assert.rejects(guard('teams_add_reaction', 'write'), /Too many changes/);

  const daily = toolGuard({ DB: usageDb() }, 'u2', { cap: 5 });
  for (let i = 0; i < 5; i++) await daily('teams_delete_message', 'destructive');
  await assert.rejects(daily('teams_send_message', 'write'), /Daily limit of 5/);
});

test('a refused write never reaches Teams', async () => {
  const handlers = {};
  const fakeServer = { registerTool: (name, config, handler) => { handlers[name] = { config, handler }; } };
  const sent = [];
  const fakeClient = new Proxy({}, { get: (_, method) => async (...args) => { sent.push(method); return { ok: true, args }; } });
  registerTeamsTools(fakeServer, fakeClient, { beforeCall: toolGuard({ WRITE_LIMITER: limiter(0), DB: usageDb() }, 'u1') });

  const res = await handlers.teams_send_message.handler({ conversationId: '19:x', text: 'hi', mentionEveryone: true });
  assert.equal(res.isError, true);
  assert.deepEqual(sent, [], 'client.sendMessage must not be called when the guard refuses');
});

test('every tool is labelled, and labels match what the tool does', () => {
  const handlers = {};
  registerTeamsTools({ registerTool: (name, config) => { handlers[name] = config; } }, {});
  assert.deepEqual(Object.keys(handlers).sort(), [...Object.keys(TOOL_KINDS), 'teams_do', 'teams_query'].sort());
  assert.equal(handlers.teams_query.annotations.readOnlyHint, true);
  assert.equal(handlers.teams_do.annotations.readOnlyHint, false);
  assert.equal(handlers.teams_do.annotations.destructiveHint, true, 'apps ask before every teams_do call');
  for (const [name, cfg] of Object.entries(handlers)) {
    if (name === 'teams_query' || name === 'teams_do') continue;
    const kind = TOOL_KINDS[name];
    assert.equal(cfg.annotations.readOnlyHint, kind === 'read' || kind === 'heavy', name);
    if (kind === 'destructive') assert.equal(cfg.annotations.destructiveHint, true, name);
  }
  for (const w of ['teams_send_message', 'teams_reply_to_message', 'teams_add_reaction', 'teams_create_group_chat', 'teams_rename_group', 'teams_add_group_member']) {
    assert.equal(TOOL_KINDS[w], 'write', w);
  }
  for (const d of ['teams_delete_message', 'teams_remove_group_member', 'teams_leave_group']) assert.equal(TOOL_KINDS[d], 'destructive', d);
});
