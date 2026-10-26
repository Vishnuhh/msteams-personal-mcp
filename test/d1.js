// Real SQLite with the real migrations, wrapped in the small part of the D1 API the code uses.
// node:sqlite ships with Node 22.13+; older Node skips the tests that need it.
import { readFileSync, readdirSync } from 'node:fs';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* not available */ }
export const hasSqlite = Boolean(DatabaseSync);

export function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  const prepare = (sql) => {
    const st = {
      args: [],
      bind(...a) { st.args = a; return st; },
      async run() { const r = db.prepare(sql).run(...st.args); return { meta: { changes: Number(r.changes) } }; },
      async first() { return db.prepare(sql).get(...st.args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...st.args) }; },
    };
    return st;
  };
  return { db, prepare, batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
