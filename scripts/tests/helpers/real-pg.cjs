// A throwaway REAL PostgreSQL cluster for regression tests that must prove
// database behaviour (locks, unique rules, triggers, concurrency) rather than
// mock it. Fails loudly when PostgreSQL isn't installed — never skips.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

function startPg() {
  const pgRoot = '/usr/lib/postgresql';
  const bin = fs.existsSync(pgRoot) && fs.readdirSync(pgRoot).sort((a, b) => Number(b) - Number(a))
    .map(v => path.join(pgRoot, v, 'bin')).find(d => fs.existsSync(path.join(d, 'initdb')));
  if (!bin) throw new Error('PostgreSQL server binaries not found: this regression needs a real database');
  const asRoot = process.getuid && process.getuid() === 0;   // initdb refuses root
  const pgCmd = (cmd, args) => asRoot ? ['runuser', ['-u', 'postgres', '--', path.join(bin, cmd), ...args]] : [path.join(bin, cmd), args];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-pg-'));
  fs.chmodSync(dir, 0o777);
  const port = String(20000 + Math.floor(Math.random() * 20000));
  const psqlBin = fs.existsSync(path.join(bin, 'psql')) ? path.join(bin, 'psql') : 'psql';
  const base = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', dir, '-p', port, '-U', 'cw', '-d', 'postgres'];

  const [initCmd, initArgs] = pgCmd('initdb', ['-D', path.join(dir, 'data'), '-U', 'cw', '-A', 'trust', '--no-sync']);
  execFileSync(initCmd, initArgs, { stdio: 'ignore' });
  const [ctlCmd, ctlArgs] = pgCmd('pg_ctl', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses='' -c fsync=off`, 'start']);
  execFileSync(ctlCmd, ctlArgs, { stdio: 'ignore' });

  /** Run SQL (`-c`) or a file (`-f path`) in its OWN connection. */
  const psql = args => new Promise(resolve => {
    const p = spawn(psqlBin, [...base, ...args]);
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
  });
  const stop = () => {
    const [c, a] = pgCmd('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']);
    try { execFileSync(c, a, { stdio: 'ignore' }); } catch { /* not started */ }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { psql, stop };
}

/** `ERROR:  23505: duplicate key …` → { code, message } (the shape supabase-js returns). */
function pgError(err) {
  const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(err);
  return m ? { code: m[1], message: m[2] } : { code: 'XX000', message: err || 'unknown error' };
}
const lit = v => v === null || v === undefined ? 'NULL'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'`
  : `'${String(v).replace(/'/g, "''")}'`;

/**
 * Just enough of the supabase-js client, backed by the real database: every
 * statement runs as SQL in its own connection (real concurrency). Supports
 * select/insert/update with eq/neq/is/in/ilike, maybeSingle/single, and rpc().
 * `setOfFns` lists functions that return a table (rpc → array of rows).
 */
function makeDb(psql, { setOfFns = [], auth } = {}) {
  async function run(table, st) {
    const where = st.filters.length ? ` where ${st.filters.join(' and ')}` : '';
    let sql;
    if (st.op === 'insert') {
      const cols = Object.keys(st.values);
      sql = `with t as (insert into public.${table} (${cols.join(', ')}) values (${cols.map(c => lit(st.values[c])).join(', ')}) returning ${st.returning || 'id'}) select coalesce(json_agg(t), '[]') from t`;
    } else if (st.op === 'update') {
      const sets = Object.entries(st.values).map(([k, v]) => `${k} = ${lit(v)}`).join(', ');
      sql = `with t as (update public.${table} set ${sets}${where} returning ${st.returning || 'id'}) select coalesce(json_agg(t), '[]') from t`;
    } else {
      sql = `select coalesce(json_agg(t), '[]') from (select ${st.cols} from public.${table}${where}${st.limit ? ` limit ${st.limit}` : ''}) t`;
    }
    const r = await psql(['-c', sql]);
    if (r.code !== 0) return { data: null, error: pgError(r.err) };
    const rows = JSON.parse(r.out);
    if (st.op !== 'select' && !st.returning) return { data: null, error: null };
    return { data: st.one ? rows[0] ?? null : rows, error: null };
  }
  return {
    auth,
    from(table) {
      const st = { op: 'select', cols: '*', filters: [], values: null, limit: null, one: false, returning: null };
      const q = {
        select(c = '*') { if (st.op === 'select') st.cols = c; else st.returning = c; return q; },
        eq(k, v) { st.filters.push(`${k} = ${lit(v)}`); return q; },
        neq(k, v) { st.filters.push(`${k} <> ${lit(v)}`); return q; },
        is(k, v) { st.filters.push(`${k} is ${lit(v)}`); return q; },
        in(k, vs) { st.filters.push(`${k} in (${vs.map(lit).join(', ')})`); return q; },
        ilike(k, v) { st.filters.push(`${k} ilike ${lit(v)}`); return q; },
        limit(n) { st.limit = n; return q; }, order() { return q; },
        maybeSingle() { st.one = true; return q; }, single() { st.one = true; return q; },
        insert(v) { st.op = 'insert'; st.values = v; return q; },
        update(v) { st.op = 'update'; st.values = v; return q; },
        then(resolve, reject) { return run(table, st).then(resolve, reject); },
      };
      return q;
    },
    async rpc(fn, args) {
      const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
      const sql = setOfFns.includes(fn)
        ? `select coalesce(json_agg(t), '[]') from public.${fn}(${named}) t`
        : `select to_json(public.${fn}(${named}))`;
      const r = await psql(['-c', sql]);
      if (r.code !== 0) return { data: null, error: pgError(r.err) };
      return { data: JSON.parse(r.out), error: null };
    },
  };
}

module.exports = { startPg, pgError, lit, makeDb };
