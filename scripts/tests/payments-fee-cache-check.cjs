const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
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

const { confirmedFeesFromRows, confirmedFeesFromAppts, missingFeeIntents } = load('src/lib/confirmed-fees.ts');
const row = (id, pi, fee = 0) => ({ id, payment_intent_id: pi, stripe_fee: fee, amount: 100, tax: 15, tip: 0, payment_method: 'card', refunded: false, source: 'pos' });
// A refunded ORIGINAL sale keeps its fee (Stripe keeps it on a refund); only the negative refund row carries none.
assert.deepEqual(confirmedFeesFromRows([row('a', 'pi_saved', 3), row('b', 'pi_saved', 3), row('c', 'pi_zero'), { ...row('d', 'pi_refund', 2), refunded: true }, { ...row('e', 'pi_refundrow', 2), refunded: true, source: 'refund', amount: -100 }]), { pi_saved: { gross: 115, fee: 3, net: 112 }, pi_refund: { gross: 115, fee: 2, net: 113 } });
assert.deepEqual(missingFeeIntents([{ ...row('r1', 'pi_refunded_orig'), refunded: true }, { ...row('r2', 'pi_refund_row'), refunded: true, source: 'refund' }], [], {}, 8), ['pi_refunded_orig'], 'a refunded sale still needs its fee looked up; the refund row does not');
assert.deepEqual(missingFeeIntents([row('a', 'pi_missing'), row('b', 'pi_missing')], ['pi_missing', 'pi_appt'], { pi_saved: { gross: 115, fee: 3, net: 112 } }, 8), ['pi_missing', 'pi_appt']);

let saved = [row('saved', 'pi_saved', 3)];
let missing = [];
let appointments = [];
let lookups = [], writes = [], balanceReads = 0, historicalScans = 0, failSaved = false;
let savedAppts = [], readCall = 0, preMigration = false;
const db = { from(table) {
  const filters = []; let patch;
  const q = { select() { return q; }, eq(...f) { filters.push(['eq', ...f]); return q; }, not(...f) { filters.push(['not', ...f]); return q; }, or(...f) { filters.push(['or', ...f]); return q; }, is(...f) { filters.push(['is', ...f]); return q; }, gte(...f) { filters.push(['gte', ...f]); return q; }, in(...f) { filters.push(['in', ...f]); return q; }, order() { return q; }, limit() { return q; }, insert() { return q; }, update(value) { patch = value; return q; }, then(resolve, reject) {
    if (patch) {
      writes.push({ table, filters, patch });
      const target = missing.find(r => r.id === filters.find(f => f[1] === 'id')?.[2] && r.payment_intent_id === filters.find(f => f[1] === 'payment_intent_id')?.[2]);
      if (target) { target.stripe_fee = patch.stripe_fee; saved.push({ ...target }); }
      return Promise.resolve({ data: target ? [{ id: target.id }] : [], error: null }).then(resolve, reject);
    }
    if (preMigration && table === 'appointments' && filters.some(f => f[0] === 'is')) return Promise.resolve({ data: null, error: { message: 'column appointments.stripe_fee does not exist' } }).then(resolve, reject);
    return Promise.resolve({ data: table === 'transactions' ? missing : table === 'appointments' ? appointments : [], error: null }).then(resolve, reject);
  } };
  return q;
} };
const stripe = {
  balance: { retrieve: async () => { balanceReads++; return { available: [{ amount: 1000 }], pending: [] }; } },
  balanceTransactions: { list: async () => { historicalScans++; throw Error('Historical scan must not run'); } },
  payouts: { list: async () => ({ data: [] }) },
  accounts: { retrieve: async () => ({ settings: { payouts: { schedule: { interval: 'manual' } } } }) },
};
const mocks = {
  '@/lib/api-auth': { authorizeShop: async () => ({ isOwner: true, shop: { id: 'shop', stripe_account_id: 'acct_shop', stripe_connected: true } }) },
  '@/lib/platform-settings': { cardFeeEstimateSafe: async () => ({ percent: 3.7, fixed: 0.3 }) },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { stripe, confirmedStripeFee: async (pi, account) => { lookups.push({ pi, account }); return pi === 'pi_zero' ? { gross: 115, fee: 0, net: 115 } : { gross: 115, fee: 3, net: 112 }; } },
  // Two reads per request: transaction fees, then cached appointment fees (phase66).
  '@/lib/read-all-rows': { readAllRows: async () => { if (failSaved) throw Error('Fee read failed'); if (readCall++ % 2 === 0) return saved; if (preMigration) throw Error('column appointments.stripe_fee does not exist'); return savedAppts; } },
  '@/lib/confirmed-fees': { confirmedFeesFromRows, confirmedFeesFromAppts, missingFeeIntents },
};
assert.deepEqual(confirmedFeesFromAppts([{ payment_intent_id: 'pi_a', stripe_fee: 1.64, stripe_gross: 34.59 }, { payment_intent_id: 'pi_pending', stripe_fee: null, stripe_gross: null }, { payment_intent_id: 'pi_bad', stripe_fee: 1, stripe_gross: 0 }]), { pi_a: { gross: 34.59, fee: 1.64, net: 32.95 } });
const route = load('src/app/api/stripe/payments-summary/route.ts', mocks);
const call = async () => (await route.POST(new NextRequest('https://clipwise.ca/api/stripe/payments-summary', { method: 'POST', body: JSON.stringify({ shop_id: 'shop' }) }))).json();
(async () => {
  let response = await call();
  assert.deepEqual(response.byPi.pi_saved, { gross: 115, fee: 3, net: 112 });
  assert.deepEqual(response.feeEstimate, { percent: 3.7, fixed: 0.3 }, 'estimate rate delivered alongside (never mixed into) confirmed byPi');
  assert.equal(lookups.length, 0); assert.equal(writes.length, 0);
  response = await call();
  assert.equal(lookups.length, 0, 'Confirmed fee must never trigger another Stripe fee lookup');
  assert.equal(balanceReads, 2, 'Dynamic payout balance must refresh every request');

  missing = [row('missing', 'pi_missing'), row('replay', 'pi_missing')];
  appointments = [{ payment_intent_id: 'pi_missing' }];
  response = await call();
  assert.equal(lookups.length, 1, 'A replayed ledger row and appointment share one PI lookup');
  assert.deepEqual(lookups[0], { pi: 'pi_missing', account: 'acct_shop' });
  assert.equal(response.byPi.pi_missing.fee, 3);
  const txWrites = () => writes.filter(w => w.table === 'transactions');
  const apptWrites = () => writes.filter(w => w.table === 'appointments');
  assert.equal(txWrites().length, 1);
  assert(txWrites()[0].filters.some(f => f[1] === 'shop_id' && f[2] === 'shop'));
  assert(txWrites()[0].filters.some(f => f[1] === 'payment_intent_id' && f[2] === 'pi_missing'));
  // The booking's own charge is cached on the appointment too, scoped + fill-only.
  assert.equal(apptWrites().length, 1);
  assert.deepEqual(apptWrites()[0].patch, { stripe_fee: 3, stripe_gross: 115 });
  assert(apptWrites()[0].filters.some(f => f[1] === 'shop_id' && f[2] === 'shop'));
  assert(apptWrites()[0].filters.some(f => f[0] === 'is' && f[1] === 'stripe_fee' && f[2] === null));
  await call();
  assert.equal(lookups.length, 1, 'Persisted fee must be reused on the next request');
  assert.equal(balanceReads, 4);
  assert.equal(historicalScans, 0, 'No 60-page historical Stripe scan');

  missing = [row('zero', 'pi_zero')]; appointments = [];
  response = await call();
  assert.equal(response.byPi.pi_zero.fee, 0, 'A verified zero is exact for the current response');
  assert.equal(txWrites().length, 1, 'Ambiguous legacy zero must not be written as durable confirmation');
  // A cached booking fee is exact with ZERO Stripe lookups — however many bookings.
  missing = []; appointments = [{ payment_intent_id: 'pi_appt_cached' }];
  savedAppts = [{ payment_intent_id: 'pi_appt_cached', stripe_fee: 1.64, stripe_gross: 34.59 }];
  const before = lookups.length;
  response = await call();
  assert.deepEqual(response.byPi.pi_appt_cached, { gross: 34.59, fee: 1.64, net: 32.95 });
  assert.equal(lookups.length, before, 'Cached appointment fee must never trigger a Stripe lookup');
  // Before the phase66 migration runs: cache read + filter fail -> live lookups as before.
  preMigration = true; savedAppts = []; appointments = [{ payment_intent_id: 'pi_premig' }];
  response = await call();
  assert.equal(response.byPi.pi_premig.fee, 3, 'Pre-migration still resolves fees live');
  assert(!response.error, 'Missing phase66 columns must not break Payments');
  preMigration = false; appointments = [];
  failSaved = true;
  response = await call();
  assert.equal(response.feesReady, false, 'Failed fee reads cannot masquerade as confirmed zero fees');
  assert(response.error);
  failSaved = false;
  const backfillWrites = [];
  const backfillDb = { from(table) {
    const filters = []; let patch;
    const q = { select() { return q; }, eq(...f) { filters.push(['eq', ...f]); return q; }, not() { return q; }, or() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; }, update(value) { patch = value; return q; }, then(resolve, reject) {
      if (patch) { backfillWrites.push({ patch, filters }); return Promise.resolve({ data: [{ id: 'tx_backfill' }], error: null }).then(resolve, reject); }
      const data = table === 'transactions' ? [{ id: 'tx_backfill', shop_id: 'shop', payment_intent_id: 'pi_backfill', refunded: false }] : [{ id: 'shop', stripe_account_id: 'acct_shop', stripe_connected: true }];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    } };
    return q;
  } };
  const { backfillMissingStripeFees } = load('src/lib/backfill-fees.ts', { '@/lib/supabase-admin': { supabaseAdmin: backfillDb }, '@/lib/stripe': { stripeFeeCents: async (pi, account) => { assert.equal(pi, 'pi_backfill'); assert.equal(account, 'acct_shop'); return 300; } } });
  assert.deepEqual(await backfillMissingStripeFees(), { scanned: 1, filled: 1 });
  assert.equal(backfillWrites.length, 1);
  assert(backfillWrites[0].filters.some(f => f[1] === 'shop_id' && f[2] === 'shop'));
  assert(backfillWrites[0].filters.some(f => f[1] === 'payment_intent_id' && f[2] === 'pi_backfill'));
  const apptBackfillWrites = [];
  const apptBackfillDb = { from(table) {
    const filters = []; let patch;
    const q = { select() { return q; }, eq(...f) { filters.push(['eq', ...f]); return q; }, not() { return q; }, is(...f) { filters.push(['is', ...f]); return q; }, lte() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; }, update(value) { patch = value; return q; }, then(resolve, reject) {
      if (patch) { apptBackfillWrites.push({ patch, filters }); return Promise.resolve({ data: [{ id: 'appt_old' }], error: null }).then(resolve, reject); }
      const data = table === 'appointments' ? [{ id: 'appt_old', shop_id: 'shop', payment_intent_id: 'pi_old' }, { id: 'appt_noacct', shop_id: 'shop_x', payment_intent_id: 'pi_x' }] : [{ id: 'shop', stripe_account_id: 'acct_shop', stripe_connected: true }, { id: 'shop_x', stripe_account_id: null, stripe_connected: false }];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    } };
    return q;
  } };
  const apptLookups = [];
  const { backfillAppointmentStripeFees } = load('src/lib/backfill-fees.ts', { '@/lib/supabase-admin': { supabaseAdmin: apptBackfillDb }, '@/lib/stripe': { stripeFeeCents: async () => 0, confirmedStripeFee: async (pi, account) => { apptLookups.push({ pi, account }); return { gross: 40.25, fee: 1.47, net: 38.78 }; } } });
  assert.deepEqual(await backfillAppointmentStripeFees(), { scanned: 2, filled: 1 });
  assert.deepEqual(apptLookups, [{ pi: 'pi_old', account: 'acct_shop' }], 'Only connected shops are looked up, on their own account');
  assert.deepEqual(apptBackfillWrites[0].patch, { stripe_fee: 1.47, stripe_gross: 40.25 });
  assert(apptBackfillWrites[0].filters.some(f => f[1] === 'shop_id' && f[2] === 'shop'));
  assert(apptBackfillWrites[0].filters.some(f => f[0] === 'is' && f[1] === 'stripe_fee'));
  const failingDb = { from() { const q = { select() { return q; }, in() { return q; }, not() { return q; }, is() { return q; }, lte() { return q; }, order() { return q; }, limit() { return q; }, then(r) { return Promise.resolve({ data: null, error: { message: 'column appointments.stripe_fee does not exist' } }).then(r); } }; return q; } };
  const pre = load('src/lib/backfill-fees.ts', { '@/lib/supabase-admin': { supabaseAdmin: failingDb }, '@/lib/stripe': { stripeFeeCents: async () => 0, confirmedStripeFee: async () => { throw Error('must not look up'); } } });
  assert.deepEqual(await pre.backfillAppointmentStripeFees(), { scanned: 0, filled: 0 }, 'Pre-migration backfill is a quiet no-op');
  console.log('PASS fee cache: booking fees cached on the appointment, zero lookups once cached, pre-migration fallback, confirmed/pending/zero, duplicate PI, scoped write, reused fees, fresh balance and zero historical scans');
})().catch(error => { console.error(error); process.exitCode = 1; });
