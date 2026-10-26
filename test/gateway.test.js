import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerTeamsTools, TOOL_KINDS, TOOLS_VERSION } from '../src/core/tools.js';

/** Registers the tools on a fake server and returns { call(name, args), calls } with a fake Teams client. */
function setup(options = {}) {
  const tools = {};
  const calls = [];
  const client = new Proxy({}, { get: (_, method) => async (...args) => { calls.push({ method, args }); return { ok: method }; } });
  registerTeamsTools({ registerTool: (name, config, handler) => { tools[name] = handler; } }, client, options);
  return { call: (name, args) => tools[name](args), calls };
}
const json = (r) => JSON.parse(r.content[0].text);

test('the named tools are frozen: changing them means bumping TOOLS_VERSION', () => {
  // Apps cache this list when they connect. Add new features as actions instead (no refresh needed).
  assert.equal(TOOLS_VERSION, 2);
  assert.equal(Object.keys(TOOL_KINDS).length, 27);
});

test('help lists every action with its arguments and which gateway runs it', async () => {
  const { call } = setup();
  const { actions } = json(await call('teams_query', { action: 'help' }));
  const read = actions.find((a) => a.action === 'read_file');
  assert.equal(read.via, 'teams_query');
  assert.match(read.args.conversationId, /^string/);
  assert.match(read.args.index, /number, optional/);
  assert.equal(actions.find((a) => a.action === 'send_message').via, 'teams_do');
  assert.equal(actions.length, Object.keys(TOOL_KINDS).length);
});

test('teams_query runs reading actions only; teams_do runs changes only', async () => {
  const { call, calls } = setup();
  assert.equal(json(await call('teams_query', { action: 'list_chats', args: { limit: 5 } })).ok, 'listChats');
  assert.deepEqual(calls[0], { method: 'listChats', args: [{ limit: 5 }] });

  const refused = await call('teams_query', { action: 'send_message', args: { conversationId: '19:x@thread.v2', text: 'hi' } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /use teams_do/);
  assert.equal(calls.length, 1, 'nothing was sent');

  assert.equal(json(await call('teams_do', { action: 'teams_send_message', args: { conversationId: '19:x@thread.v2', text: 'hi' } })).ok, 'sendMessage');
  const wrongWay = await call('teams_do', { action: 'list_chats', args: {} });
  assert.match(wrongWay.content[0].text, /only reads: use teams_query/);
});

test('arguments are checked strictly before anything runs', async () => {
  const { call, calls } = setup();
  const missing = await call('teams_do', { action: 'send_message', args: { text: 'hi' } });
  assert.match(missing.content[0].text, /Invalid arguments for send_message: conversationId/);
  const extra = await call('teams_query', { action: 'list_chats', args: { limit: 5, everyone: true } });
  assert.match(extra.content[0].text, /Invalid arguments/);
  const unknown = await call('teams_query', { action: 'format_disk' });
  assert.match(unknown.content[0].text, /Unknown action "format_disk"/);
  assert.equal(calls.length, 0);
});

test('limits and usage see the real action, and the refresh notice is appended', async () => {
  const seen = [];
  const { call } = setup({
    beforeCall: (name, kind) => { seen.push(['before', name, kind]); },
    afterCall: (name, kind) => { seen.push(['after', name, kind]); },
    notice: () => 'Refresh the Teams connector.',
  });
  const r = await call('teams_query', { action: 'search_messages', args: { query: 'deploy' } });
  assert.deepEqual(seen, [['before', 'teams_search_messages', 'heavy'], ['after', 'teams_search_messages', 'heavy']]);
  assert.equal(r.content.at(-1).text, 'Refresh the Teams connector.');
});
