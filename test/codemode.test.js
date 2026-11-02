// Code mode: the QuickJS sandbox, and teams_run_code through the gateway (read-only, budgeted, counted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-ng-wasmfile-release-sync';
import { codeRunner, runCode, CODE_LIMITS } from '../src/core/code-mode.js';
import { registerTeamsTools } from '../src/core/tools.js';

const QuickJS = await newQuickJSWASMModuleFromVariant(variant);
const run = (code, tools = {}, limits) => runCode(QuickJS, code, tools, limits);
const later = (v, ms = 5) => new Promise((r) => setTimeout(() => r(v), ms));

test('a program calls tools, awaits them in parallel and returns plain data', async () => {
  const tools = {
    list: async () => later({ items: [{ id: 'a', n: 3 }, { id: 'b', n: 0 }, { id: 'c', n: 7 }] }),
    count: async ({ id }) => later({ id, total: id.length * 10 }),
  };
  const r = await run(`
    const { items } = await teams.list({});
    const busy = items.filter((i) => i.n > 0);
    const totals = await Promise.all(busy.map((i) => teams.count({ id: i.id })));
    console.log('busy', busy.length);
    return totals.map((t) => t.id + ':' + t.total);`, tools);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result, ['a:10', 'c:10']);
  assert.deepEqual(r.logs, ['busy 2']);
  assert.equal(r.calls, 3);
});

test('the sandbox has nothing from the host but teams and console', async () => {
  const r = await run('return [typeof fetch, typeof process, typeof require, typeof setTimeout, typeof globalThis.teams, typeof console.log].join(" ")');
  assert.equal(r.result, 'undefined undefined undefined undefined object function');
});

test('limits: computing, memory, never-ending waits, errors and big results all end cleanly', async () => {
  assert.match((await run('while (true) {}')).error, /computed for too long/);
  assert.match((await run('const a = []; for (;;) a.push("x".repeat(1e6));', {}, { ticks: 1e6, memoryBytes: 8 * 1024 * 1024 })).error, /too much memory|computed for too long/);
  assert.match((await run('await new Promise(() => {}); return 1')).error, /never finishes/);
  assert.equal((await run('throw new Error("boom")')).error, 'boom');
  assert.match((await run('syntax error here')).error, /./);
  assert.match((await run('return await teams.f({})', { f: async () => { throw new Error('Teams said no'); } })).error, /Teams said no/);
  assert.match((await run('return await teams.f({})', { f: async () => ({ x: 'y'.repeat(700_000) }) })).error, /^f: The result was too large.*smaller limit/);
  const big = await run('return "z".repeat(50000)');
  assert.equal(big.ok, true);
  assert.match(big.result, /cut at 20,000 characters/);
  assert.equal((await run('return undefined')).result, undefined);
});

test('the runner loads QuickJS once and reuses it', async () => {
  let loads = 0;
  const runner = codeRunner(async () => { loads++; return QuickJS; });
  assert.equal((await runner('return 1', {})).result, 1);
  assert.equal((await runner('return 2', {})).result, 2);
  assert.equal(loads, 1);
});

/** The tools on a fake server with a fake Teams client, plus code mode. */
function setup(options = {}) {
  const tools = {};
  const calls = [];
  const client = new Proxy({}, {
    get: (_, method) => async (...args) => {
      calls.push(method);
      if (method === 'findChats') return { chats: [{ id: '19:a@thread.v2', title: 'Squad A' }, { id: '19:b@thread.v2', title: 'Squad B' }] };
      if (method === 'getMessages') return { messages: [{ text: 'invoice due' }, { text: 'lunch?' }, { text: 'invoice paid' }] };
      return { ok: method };
    },
  });
  registerTeamsTools({ registerTool: (name, config, handler) => { tools[name] = { config, handler }; } }, client,
    { runCode: codeRunner(async () => QuickJS), ...options });
  return { call: (name, args) => tools[name].handler(args), calls, tools };
}
const json = (r) => JSON.parse(r.content[0].text);

test('teams_run_code is a read action: it combines several reads into one answer', async () => {
  const seen = [];
  const { call, calls } = setup({ beforeCall: (name, kind) => { seen.push(`${name}:${kind}`); } });
  const r = await call('teams_query', { action: 'run_code', args: { code: `
    const { chats } = await teams.find_chat({ query: 'Squad' });
    const all = await Promise.all(chats.map((c) => teams.get_messages({ conversationId: c.id, since: '24h' })));
    return chats.map((c, i) => ({ chat: c.title, invoices: all[i].messages.filter((m) => m.text.includes('invoice')).length }));` } });
  assert.equal(r.isError, undefined, r.content?.[0]?.text);
  assert.deepEqual(json(r).result, [{ chat: 'Squad A', invoices: 2 }, { chat: 'Squad B', invoices: 2 }]);
  assert.equal(json(r).actionsCalled, 3);
  assert.deepEqual(calls, ['findChats', 'getMessages', 'getMessages']);
  // Every inner call goes through the same limits and counting as a normal tool call.
  assert.deepEqual(seen, ['teams_run_code:read', 'teams_find_chat:read', 'teams_get_messages:read', 'teams_get_messages:read']);
});

test('programs cannot change Teams, read files or call themselves', async () => {
  const { call, calls } = setup();
  for (const name of ['send_message', 'delete_message', 'add_reaction', 'read_file', 'run_code']) {
    const r = await call('teams_query', { action: 'run_code', args: { code: `return typeof teams.${name}` } });
    assert.equal(json(r).result, 'undefined', name);
  }
  const help = json(await call('teams_query', { action: 'help' })).actions;
  assert.equal(help.find((a) => a.action === 'run_code').via, 'teams_query');
  assert.equal(calls.length, 0);
});

test('one run stays inside the request budget; bad arguments and refusals reach the program', async () => {
  const { call } = setup();
  const heavy = await call('teams_query', { action: 'run_code', args: { code: `
    await teams.search_messages({ query: 'a' });
    await teams.search_messages({ query: 'b' });` } });
  assert.equal(heavy.isError, true);
  assert.match(heavy.content[0].text, /Request budget used up: search_messages needs 30 of the 45/);
  const many = await call('teams_query', { action: 'run_code', args: { code: `for (let i = 0; i < 20; i++) await teams.list_chats({}); return 1` } });
  assert.match(many.content[0].text, /budget used up/);
  assert.equal(CODE_LIMITS.budget / CODE_LIMITS.costRead, 15, '15 ordinary reads per run');
  const bad = await call('teams_query', { action: 'run_code', args: { code: `return await teams.get_messages({ chat: 'x' })` } });
  assert.match(bad.content[0].text, /Invalid arguments for get_messages/);

  const limited = setup({ beforeCall: (name) => { if (name === 'teams_get_messages') throw new Error('Too many requests. Wait a minute.'); } });
  const r = await limited.call('teams_query', { action: 'run_code', args: { code: `return await teams.get_messages({ conversationId: '19:a@thread.v2' })` } });
  assert.match(r.content[0].text, /Too many requests/);
});

test('without a runner (e.g. tests, other hosts) there is no run_code action', async () => {
  const tools = {};
  registerTeamsTools({ registerTool: (name, config, handler) => { tools[name] = handler; } }, {}, {});
  const help = JSON.parse((await tools.teams_query({ action: 'help' })).content[0].text).actions;
  assert.equal(help.some((a) => a.action === 'run_code'), false);
});
