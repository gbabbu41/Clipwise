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

const { confirmedFeesFromRows, missingFeeIntents } = load('src/lib/confirmed-fees.ts');
const row = (id, pi, fee = 0) => ({ id, payment_intent_id: pi, stripe_fee: fee, amount: 100, tax: 15, tip: 0, payment_method: 'card', refunded: false, source: 'pos' });
assert.deepEqual(confirmedFeesFromRows([row('a', 'pi_saved', 3), row('b', 'pi_saved', 3), row('c', 'pi_zero'), { ...row('d', 'pi_refund', 2), refunded: true }]), { pi_saved: { gross: 115, fee: 3, net: 112 } });
assert.deepEqual(missingFeeIntents([row('a', 'pi_missing'), row('b', 'pi_missing')], ['pi_missing', 'pi_appt'], { pi_saved: { gross: 115, fee: 3, net: 112 } }, 8), ['pi_missing', 'pi_appt']);

let saved = [row('saved', 'pi_saved', 3)];
let missing = [];
let appointments = [];
let lookups = [], writes = [], balanceReads = 0, historicalScans = 0, failSaved = false;
const db = { from(table) {
  const filters = []; let patch;
  const q = { select() { return q; }, eq(...f) { filters.push(['eq', ...f]); return q; }, not(...f) { filters.push(['not', ...f]); return q; }, or(...f) { filters.push(['or', ...f]); return q; }, gte(...f) { filters.push(['gte', ...f]); return q; }, in(...f) { filters.push(['in', ...f]); return q; }, order() { return q; }, limit() { return q; }, insert() { return q; }, update(value) { patch = value; return q; }, then(resolve, reject) {
    if (patch) {
      writes.push({ table, filters, patch });
      const target = missing.find(r => r.id === filters.find(f => f[1] === 'id')?.[2] && r.payment_intent_id === filters.find(f => f[1] === 'payment_intent_id')?.[2]);
      if (target) { target.stripe_fee = patch.stripe_fee; saved.push({ ...target }); }
      return Promise.resolve({ data: target ? [{ id: target.id }] : [], error: null }).then(resolve, reject);
    }
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
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { stripe, confirmedStripeFee: async (pi, account) => { lookups.push({ pi, account }); return pi === 'pi_zero' ? { gross: 115, fee: 0, net: 115 } : { gross: 115, fee: 3, net: 112 }; } },
  '@/lib/read-all-rows': { readAllRows: async () => { if (failSaved) throw Error('Fee read failed'); return saved; } },
  '@/lib/confirmed-fees': { confirmedFeesFromRows, missingFeeIntents },
};
const route = load('src/app/api/stripe/payments-summary/route.ts', mocks);
const call = async () => (await route.POST(new NextRequest('https://clipwise.ca/api/stripe/payments-summary', { method: 'POST', body: JSON.stringify({ shop_id: 'shop' }) }))).json();
(async () => {
  let response = await call();
  assert.deepEqual(response.byPi.pi_saved, { gross: 115, fee: 3, net: 112 });
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
  assert.equal(writes.length, 1);
  assert(writes[0].filters.some(f => f[1] === 'shop_id' && f[2] === 'shop'));
  assert(writes[0].filters.some(f => f[1] === 'payment_intent_id' && f[2] === 'pi_missing'));
  await call();
  assert.equal(lookups.length, 1, 'Persisted fee must be reused on the next request');
  assert.equal(balanceReads, 4);
  assert.equal(historicalScans, 0, 'No 60-page historical Stripe scan');

  missing = [row('zero', 'pi_zero')]; appointments = [];
  response = await call();
  assert.equal(response.byPi.pi_zero.fee, 0, 'A verified zero is exact for the current response');
  assert.equal(writes.length, 1, 'Ambiguous legacy zero must not be written as durable confirmation');
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
  console.log('PASS fee cache: confirmed/pending/zero, duplicate PI, scoped write, reused fees, fresh balance and zero historical scans');
})().catch(error => { console.error(error); process.exitCode = 1; });
