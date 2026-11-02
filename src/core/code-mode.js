// Code mode: run a short JavaScript program written by the assistant in a QuickJS sandbox (WebAssembly), so it can
// call several read actions, filter and combine their results, and return only what matters.
//
// The sandbox has no network, files, timers, environment or host objects: only `teams.<action>(args)` (read actions,
// each counted and limited like a normal tool call) and `console.log`. Limits are counted, not timed, because Workers
// freeze clocks during pure computation: the interrupt handler runs every few thousand bytecode operations.
// Free: QuickJS runs inside the existing Worker (no Dynamic Workers, no paid plan).

export const CODE_LIMITS = {
  codeChars: 10_000,
  // Outgoing requests one run may cause. Workers Free allows 50 per request; the rest is headroom for sign-in refresh.
  budget: 45,
  costRead: 3, // a read action: one or two calls to Microsoft
  costHeavy: 30, // a cross-chat read fans out to many chats
  costChats: 15, // list_chats / find_chat: the list, contacts, and up to 6 name lookups (two requests each)
  ticks: 30, // about 10 ms of computing on Cloudflare
  memoryBytes: 32 * 1024 * 1024,
  timeoutMs: 25_000,
  resultChars: 600_000, // one action's result, as JSON, entering the sandbox
  outputChars: 20_000, // what the program returns
  logs: 30,
};

/** Wraps a QuickJS loader: the module (and its Wasm) loads once per isolate, on the first run. */
export function codeRunner(loadQuickJS) {
  let module = null;
  return async (code, tools, options) => {
    module ||= loadQuickJS().catch((e) => { module = null; throw e; });
    return runCode(await module, code, tools, options);
  };
}

const why = (e) => {
  const m = String(e?.message || e);
  return /out of memory/i.test(m) ? 'Stopped: the program used too much memory.' : m;
};
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}… [cut at ${n.toLocaleString('en-US')} characters]` : s);

/**
 * Runs `code` (the body of an async function) with `tools` ({ name: async (args) => data }).
 * Returns { ok, result?, error?, logs, calls }. Never throws.
 */
export async function runCode(QuickJS, code, tools, limits = {}) {
  const L = { ...CODE_LIMITS, ...limits };
  const started = Date.now();
  const logs = [];
  const pending = new Set();
  const deferreds = [];
  let calls = 0;
  let ticks = 0;
  const stopped = () => ticks > L.ticks;
  const done = (fields) => ({ logs, calls, ms: Date.now() - started, ...fields });
  const tooLong = 'Stopped: the program computed for too long. Keep loops small and let the actions do the work.';

  const rt = QuickJS.newRuntime();
  rt.setMemoryLimit(L.memoryBytes);
  rt.setMaxStackSize(256 * 1024);
  rt.setInterruptHandler(() => ++ticks > L.ticks);
  const vm = rt.newContext();
  const jsonParse = vm.getProp(vm.global, 'JSON').consume((J) => vm.getProp(J, 'parse'));
  // Results enter through QuickJS's native JSON.parse (compiling them as source is several times slower).
  const toVm = (value) => {
    const text = JSON.stringify(value ?? null);
    if (text.length > L.resultChars) throw new Error(`The result was too large for a program (${text.length.toLocaleString('en-US')} characters). Ask for fewer items (a smaller limit, or since).`);
    return vm.newString(text).consume((s) => vm.unwrapResult(vm.callFunction(jsonParse, vm.undefined, s)));
  };
  const show = (h) => { const v = vm.dump(h); return typeof v === 'string' ? v : JSON.stringify(v); };
  try {
    const teams = vm.newObject();
    for (const name of Object.keys(tools)) {
      vm.newFunction(name, (argHandle) => {
        const d = vm.newPromise();
        deferreds.push(d);
        let args;
        try { args = argHandle === undefined ? {} : vm.dump(argHandle); } catch { args = {}; }
        calls++;
        const p = Promise.resolve()
          .then(() => tools[name](args ?? {}))
          .then((r) => {
            if (!d.alive) return;
            try { toVm(r).consume((h) => d.resolve(h)); } catch (e) { throw new Error(`${name}: ${e.message}`); }
          })
          .catch((err) => { if (d.alive) vm.newError(String(err?.message || err).slice(0, 500)).consume((e) => d.reject(e)); })
          .finally(() => pending.delete(p));
        pending.add(p);
        return d.handle;
      }).consume((fn) => vm.setProp(teams, name, fn));
    }
    vm.setProp(vm.global, 'teams', teams);
    teams.dispose();
    const consoleObj = vm.newObject();
    vm.newFunction('log', (...a) => { if (logs.length < L.logs) logs.push(clip(a.map(show).join(' '), 1000)); })
      .consume((fn) => vm.setProp(consoleObj, 'log', fn));
    vm.setProp(vm.global, 'console', consoleObj);
    consoleObj.dispose();

    const result = vm.evalCode(`(async () => {\n${code}\n})()`, 'program.js');
    if (result.error) { const e = vm.dump(result.error); result.error.dispose(); return done({ ok: false, error: stopped() ? tooLong : why(e) }); }
    const promise = result.value;
    const deadline = started + L.timeoutMs;
    try {
      for (;;) {
        const jobs = rt.executePendingJobs();
        if (jobs.error) jobs.error.dispose();
        const state = vm.getPromiseState(promise);
        if (state.type === 'fulfilled') {
          const value = vm.dump(state.value);
          state.value.dispose();
          const text = value === undefined ? 'null' : JSON.stringify(value);
          return done({ ok: true, result: text.length > L.outputChars ? clip(text, L.outputChars) : value });
        }
        if (state.type === 'rejected') {
          const e = vm.dump(state.error);
          state.error.dispose();
          return done({ ok: false, error: stopped() ? tooLong : why(e) });
        }
        if (!pending.size) return done({ ok: false, error: 'The program is waiting for something that never finishes. Await only teams.* calls.' });
        const left = deadline - Date.now();
        if (left <= 0) return done({ ok: false, error: `Stopped after ${L.timeoutMs / 1000} seconds.` });
        let timer;
        await Promise.race([Promise.race([...pending]).catch(() => {}), new Promise((r) => { timer = setTimeout(r, left); })]);
        clearTimeout(timer);
      }
    } finally {
      promise.dispose();
    }
  } catch (e) {
    return done({ ok: false, error: why(e) });
  } finally {
    for (const d of deferreds) if (d.alive) d.dispose();
    jsonParse.dispose();
    try { vm.dispose(); rt.dispose(); } catch { /* a handle still referenced at teardown; the runtime is dropped anyway */ }
  }
}
