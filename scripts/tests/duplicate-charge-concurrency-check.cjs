// One Stripe charge = one ledger row, proven against a REAL Postgres: a throwaway
// cluster gets the real phase67 migration, then the real save code runs two
// simultaneous saves of the same charge. The database keeps exactly one row, the
// losing save returns the verified existing row, nothing is charged again, and
// any other failure stays visible.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const { NextRequest } = req('next/server');

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}

// ── Throwaway PostgreSQL cluster ────────────────────────────────────────────
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
const psqlArgs = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', dir, '-p', port, '-U', 'cw', '-d', 'postgres'];

function psql(args) {
  return new Promise(resolve => {
    const p = spawn(psqlBin, [...psqlArgs, ...args]);
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
function pgError(err) {
  const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(err);
  return m ? { code: m[1], message: m[2] } : { code: 'XX000', message: err || 'unknown error' };
}
const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

// Just enough of the Supabase client for these writers — every `transactions`
// statement runs as real SQL in its own connection (real concurrency); the other
// tables are small in-memory fixtures. `insertGate` holds inserts until two are
// pending, so both saves have passed their "already recorded?" checks before
// either reaches the database: the worst-case interleaving, every time.
let insertGate = null, fixtures, logs, notes;
function gate() {
  if (!insertGate) return Promise.resolve();
  return new Promise(resolve => {
    insertGate.push(resolve);
    if (insertGate.length >= 2) { const waiting = insertGate; insertGate = null; waiting.forEach(r => r()); }
  });
}
async function runTx(st) {
  const where = st.filters.length ? ` where ${st.filters.join(' and ')}` : '';
  if (st.op === 'insert') {
    await gate();
    const cols = Object.keys(st.values);
    const r = await psql(['-c', `insert into public.transactions (${cols.join(', ')}) values (${cols.map(c => lit(st.values[c])).join(', ')}) returning json_build_object('id', id)`]);
    if (r.code !== 0) return { data: null, error: pgError(r.err) };
    return { data: st.returning ? JSON.parse(r.out) : null, error: null };
  }
  if (st.op === 'update') {
    const sets = Object.entries(st.values).map(([k, v]) => `${k} = ${lit(v)}`).join(', ');
    const r = await psql(['-c', `update public.transactions set ${sets}${where}`]);
    return r.code === 0 ? { data: null, error: null } : { data: null, error: pgError(r.err) };
  }
  const r = await psql(['-c', `select coalesce(json_agg(t), '[]'::json) from (select ${st.cols} from public.transactions${where}${st.limit ? ` limit ${st.limit}` : ''}) t`]);
  if (r.code !== 0) return { data: null, error: pgError(r.err) };
  const rows = JSON.parse(r.out);
  return { data: st.one ? rows[0] ?? null : rows, error: null };
}
const db = { from(table) {
  const st = { op: 'select', cols: '*', filters: [], values: null, limit: null, one: false, returning: false };
  const q = {
    select(c = '*') { if (st.op === 'insert') st.returning = true; else st.cols = c; return q; },
    eq(k, v) { st.filters.push(`${k} = ${lit(v)}`); return q; },
    neq(k, v) { st.filters.push(`${k} <> ${lit(v)}`); return q; },
    is(k, v) { st.filters.push(`${k} is ${lit(v)}`); return q; },
    in(k, vs) { st.filters.push(`${k} in (${vs.map(lit).join(', ')})`); return q; },
    limit(n) { st.limit = n; return q; }, order() { return q; },
    maybeSingle() { st.one = true; return q; }, single() { st.one = true; return q; },
    insert(v) { st.op = 'insert'; st.values = v; return q; },
    update(v) { st.op = 'update'; st.values = v; return q; },
    then(resolve, reject) {
      const run = table === 'transactions' ? runTx(st) : Promise.resolve().then(() => {
        if (table === 'error_logs') { logs.push(st.values); return { data: null, error: null }; }
        if (st.op !== 'select') return { data: null, error: null };
        return { data: fixtures[table] ?? null, error: null };
      });
      return run.then(resolve, reject);
    },
  };
  return q;
} };
const count = async (where = 'true') => Number((await psql(['-c', `select count(*) from public.transactions where ${where}`])).out);

// Stripe: an idempotency key collapses repeats into ONE charge (as Stripe does);
// capturing an already-captured payment is refused (as Stripe does).
let charges, captures, piState;
const stripe = {
  paymentIntents: {
    async create(params, opts) {
      const key = opts?.idempotencyKey;
      if (!charges.has(key)) charges.set(key, { id: `pi_bal_${charges.size + 1}`, status: 'succeeded' });
      return charges.get(key);
    },
    async retrieve(id) { return { id, status: piState[id], metadata: { flow: 'pos_terminal_sale', shop_id: SHOP, subtotal: '40', tip: '5', tax: '6', barber_id: '' } }; },
    async capture(id) {
      if (piState[id] !== 'requires_capture') throw new Error(`This PaymentIntent could not be captured because it has a status of ${piState[id]}.`);
      captures.push(id); piState[id] = 'succeeded';
      return { id, status: 'succeeded', metadata: (await stripe.paymentIntents.retrieve(id)).metadata };
    },
  },
};

const SHOP = '11111111-1111-4111-8111-111111111111', OTHER_SHOP = '22222222-2222-4222-8222-222222222222';
const APPT = '33333333-3333-4333-8333-333333333333', APPT_2 = '44444444-4444-4444-8444-444444444444';
function reset() {
  insertGate = null; logs = []; notes = []; charges = new Map(); captures = []; piState = {};
  fixtures = {
    shops: { id: SHOP, owner_id: 'owner', stripe_account_id: 'acct_shop', stripe_connected: true, name: 'Shop' },
    services: { name: 'Skin Fade' },
  };
}
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { stripe, stripeFeeCents: async () => 164, STRIPE_LIVE_MODE: false },
  '@/lib/payment-notify': { sendPaymentReceipt: async () => {}, notifyNoShowCharged: async () => {} },
  '@/lib/completion-server': { runServerCompletionEffects: async () => {} },
  '@/lib/emailer': { sendAppEmail: async () => {} },
  '@/lib/pricing': {},
  '@/lib/notify-server': { insertNotifications: n => { notes.push(n); } },
  '@/lib/commission-server': { posCommissionFor: async () => 0 },
  '@/lib/api-auth': {
    authorizeAppointment: async () => ({ appointment: fixtures.appointment, shop: fixtures.shops }),
    authorizeShop: async () => ({ shop: fixtures.shops, isOwner: true }),
  },
};
const post = body => new NextRequest('https://clipwise.ca/api', { method: 'POST', body: JSON.stringify(body) });

(async () => {
  try {
    const [initCmd, initArgs] = pgCmd('initdb', ['-D', path.join(dir, 'data'), '-U', 'cw', '-A', 'trust', '--no-sync']);
    execFileSync(initCmd, initArgs, { stdio: 'ignore' });
    const [ctlCmd, ctlArgs] = pgCmd('pg_ctl', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses='' -c fsync=off`, 'start']);
    execFileSync(ctlCmd, ctlArgs, { stdio: 'ignore' });

    // The prod shape of the columns these writers touch (incl. its CHECKs and the
    // existing Checkout-session rule), then the REAL phase67 migration file.
    const schema = await psql(['-c', `create table public.transactions (
      id uuid primary key default gen_random_uuid(), shop_id uuid, barber_id uuid, appointment_id uuid,
      client_name text, client_email text, service_name text, amount numeric, tip numeric, tax numeric,
      stripe_fee numeric, commission_amount numeric,
      payment_method text check (payment_method = any (array['card','cash','online'])),
      type text default 'service' check (type = any (array['service','product','tip'])),
      source text, refunded boolean not null default false, payment_intent_id text, stripe_session_id text,
      created_at timestamptz default now());
      create unique index transactions_stripe_session_id_unique on public.transactions (stripe_session_id) where stripe_session_id is not null;`]);
    assert.equal(schema.code, 0, schema.err);
    const migration = await psql(['-f', path.join(root, 'supabase/migrations/phase67_transactions_one_row_per_charge.sql')]);
    assert.equal(migration.code, 0, migration.err);
    assert.match(migration.out, /transactions_one_row_per_charge\|t\|t\|/, 'rule created valid + unique');

    // 1. The rule itself, at the database: a genuinely overlapping second save of
    //    one charge waits for the first, then is rejected — naming the rule.
    reset();
    const row = pi => `insert into public.transactions (shop_id, amount, payment_method, source, payment_intent_id) values ('${SHOP}', 35, 'card', 'completion', ${lit(pi)})`;
    const [slow, fast] = await Promise.all([
      psql(['-c', `begin; ${row('pi_db')}; select pg_sleep(0.4); commit;`]),
      new Promise(r => setTimeout(r, 100)).then(() => psql(['-c', row('pi_db')])),
    ]);
    assert.equal(slow.code, 0, slow.err);
    assert.notEqual(fast.code, 0);
    assert.deepEqual(pgError(fast.err).code, '23505');
    assert.match(fast.err, /transactions_one_row_per_charge/);
    assert.equal(await count(`payment_intent_id = 'pi_db'`), 1);
    // Refund audit rows reuse the charge's payment id (allowed); rows with no
    // payment id (cash, gift sales, legacy) are unrestricted; the same charge
    // can't be booked into another shop; a legacy row with no source still counts.
    assert.equal((await psql(['-c', `insert into public.transactions (shop_id, amount, payment_method, source, refunded, payment_intent_id) values ('${SHOP}', -35, 'card', 'refund', true, 'pi_db')`])).code, 0);
    assert.equal((await psql(['-c', `${row(null)}; ${row(null)}`])).code, 0);
    assert.equal(pgError((await psql(['-c', row('pi_db').replace(SHOP, OTHER_SHOP)])).err).code, '23505');
    assert.equal((await psql(['-c', `insert into public.transactions (shop_id, amount, payment_method, payment_intent_id) values ('${SHOP}', 20, 'card', 'pi_legacy')`])).code, 0);
    assert.equal(pgError((await psql(['-c', `insert into public.transactions (shop_id, amount, payment_method, payment_intent_id) values ('${SHOP}', 20, 'card', 'pi_legacy')`])).err).code, '23505');

    // 2. Online booking payment: webhook + customer return save at the same moment.
    const { recordOnlinePaymentTx } = load('src/lib/finalize-appointment-payment.ts', mocks);
    reset(); insertGate = [];
    const args = { appointmentId: APPT, shopId: SHOP, barberId: null, clientName: 'C', serviceName: 'Skin Fade', amountDollars: 35, taxDollars: 5.25, paymentIntentId: 'pi_online' };
    const both = await Promise.all([recordOnlinePaymentTx(args), recordOnlinePaymentTx(args)]);
    assert.equal(await count(`payment_intent_id = 'pi_online'`), 1, 'exactly one row');
    const [won] = JSON.parse((await psql(['-c', `select json_agg(id) from public.transactions where payment_intent_id = 'pi_online'`])).out);
    assert.deepEqual(both.map(r => r.duplicate).sort(), [false, true]);
    assert.equal(both.find(r => r.duplicate).id, won, 'loser returns the verified existing row');
    assert.equal(logs.length, 0, 'a resolved duplicate is not an error');
    assert.equal(charges.size + captures.length, 0, 'saving never charges');

    // 3. Post-visit tip (its own charge): one row, one "Tip received" alert.
    const { recordTipFromCheckout } = load('src/lib/finalize-tip.ts', mocks);
    reset(); insertGate = [];
    const tip = { appointmentId: APPT, shopId: SHOP, barberId: null, clientName: 'C', tipDollars: 8, paymentIntentId: 'pi_tip' };
    const tips = await Promise.all([recordTipFromCheckout(tip), recordTipFromCheckout(tip)]);
    assert.equal(await count(`payment_intent_id = 'pi_tip'`), 1);
    assert.deepEqual(tips.map(t => t.recorded).sort(), [false, true]);
    assert.equal(notes.length, 1, 'one alert');

    // 4. Collect balance, double tap: ONE Stripe charge (same idempotency key), one row, both succeed.
    const { POST: collectBalance } = load('src/app/api/appointments/collect-balance/route.ts', mocks);
    reset(); insertGate = [];
    fixtures.appointment = { id: APPT_2, shop_id: SHOP, barber_id: null, service_id: 'svc', client_name: 'C', total_amount: 74.75, tax_amount: 9.75, balance_due: 34.5, stripe_customer_id: 'cus', stripe_payment_method_id: 'pm' };
    const taps = await Promise.all([collectBalance(post({ appointment_id: APPT_2, method: 'card' })), collectBalance(post({ appointment_id: APPT_2, method: 'card' }))]);
    assert.deepEqual(taps.map(r => r.status), [200, 200]);
    assert.equal(charges.size, 1, 'one charge');
    assert.equal(await count(`source = 'balance' and appointment_id = '${APPT_2}'`), 1, 'one balance row');
    assert.equal(logs.length, 0);

    // 5. Terminal/POS save path (insertLedgerRow): the second capture request sees
    //    the payment already captured, both saves race — one row, same id to both.
    const { POST: terminalCapture } = load('src/app/api/stripe/terminal/capture/route.ts', mocks);
    reset(); insertGate = []; piState.pi_tap = 'requires_capture';
    const first = terminalCapture(post({ shop_id: SHOP, payment_intent_id: 'pi_tap' }));
    while (!captures.length) await new Promise(r => setTimeout(r, 5));
    const second = terminalCapture(post({ shop_id: SHOP, payment_intent_id: 'pi_tap' }));
    const tapBodies = await Promise.all([first, second].map(p => p.then(r => r.json())));
    assert.equal(await count(`payment_intent_id = 'pi_tap'`), 1);
    assert.equal(captures.length, 1, 'captured once');
    assert.equal(tapBodies[0].transactionId, tapBodies[1].transactionId, 'both answer with the recorded sale');
    assert.equal(notes.length, 0);

    // 6. Other failures stay visible: an unverifiable conflict (same charge id in
    //    another shop) is logged, not reported as saved; a non-duplicate error is returned.
    reset(); insertGate = [];
    const mixed = await Promise.all([recordOnlinePaymentTx({ ...args, paymentIntentId: 'pi_x' }), recordOnlinePaymentTx({ ...args, shopId: OTHER_SHOP, paymentIntentId: 'pi_x' })]);
    assert.equal(await count(`payment_intent_id = 'pi_x'`), 1);
    assert.equal(mixed.filter(r => r === null).length, 1, 'the loser from another shop is not reported as saved');
    assert.equal(mixed.find(r => r !== null).duplicate, false);
    assert.equal(logs.length, 1); assert.equal(logs[0].source, 'ledger-save');
    const { insertLedgerRow } = load('src/lib/ledger-insert.ts', mocks);
    const bad = await insertLedgerRow({ shop_id: SHOP, amount: 1, payment_method: 'bogus', payment_intent_id: 'pi_bad', source: 'pos' }, []);
    assert.equal(bad.duplicate, false); assert.equal(bad.error.code, '23514');

    // 7. Every card writer is wired to resolve (not log) a duplicate, and the POS /
    //    Terminal / webhook-balance losers return before repeating side effects.
    const src = f => fs.readFileSync(path.join(root, f), 'utf8');
    for (const f of ['src/lib/finalize-appointment-payment.ts', 'src/app/api/stripe/capture-appointment/route.ts', 'src/app/api/webhooks/stripe/route.ts', 'src/app/api/appointments/collect-balance/route.ts']) {
      assert(src(f).includes('resolveDuplicateCharge('), `${f} resolves duplicates`);
    }
    const pos = src('src/app/api/stripe/pos-finalize/route.ts');
    assert(pos.indexOf('if (ins.duplicate)') > 0 && pos.indexOf('if (ins.duplicate)') < pos.indexOf('consumePromo('), 'POS duplicate returns before promo/loyalty/inventory/receipt');
    const term = src('src/app/api/stripe/terminal/capture/route.ts');
    assert(term.indexOf('if (ins.duplicate)') < term.indexOf('Decrement inventory'), 'Terminal duplicate returns before inventory');
    const hook = src('src/app/api/webhooks/stripe/route.ts');
    assert(hook.indexOf('if (alreadySaved)') < hook.indexOf('notifyBalancePaid('), 'webhook balance duplicate skips repeat alerts');

    console.log('PASS duplicate charge (real Postgres + phase67): overlapping saves → one row, loser gets the verified row, one Stripe charge/capture, one alert; refunds/cash/legacy allowed, cross-shop rejected, other errors visible; all card writers wired');
  } finally {
    const [ctlCmd, ctlArgs] = pgCmd('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']);
    try { execFileSync(ctlCmd, ctlArgs, { stdio: 'ignore' }); } catch { /* not started */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
