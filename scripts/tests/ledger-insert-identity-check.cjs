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

// Scripted transactions table: each insert consumes the next queued error (or succeeds).
let inserts, insertErrors, rows;
const PI_MISSING = 'column "payment_intent_id" of relation "transactions" does not exist';
function reset(errors = []) { inserts = []; insertErrors = [...errors]; rows = []; }
const db = { from(table) {
  const filters = []; let values, op = 'read';
  const q = {
    select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, maybeSingle() { return q; }, single() { return q; },
    in() { return q; }, order() { return q; }, limit() { return q; },
    insert(v) { values = v; op = 'insert'; return q; }, update(v) { values = v; op = 'update'; return q; },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (table === 'transactions' && op === 'insert') {
        inserts.push({ ...values });
        const message = insertErrors.shift();
        if (message) return { data: null, error: { message } };
        const row = { id: `tx${rows.length + 1}`, ...values }; rows.push(row);
        return { data: { id: row.id }, error: null };
      }
      if (table === 'transactions') {
        const [k, v] = filters[0] ?? [];
        return { data: rows.find(r => r[k] === v) ?? null, error: null };
      }
      if (table === 'shops') return { data: { id: 'shop', owner_id: 'owner', name: 'Shop', email: '', booking_settings: {}, stripe_account_id: 'acct_shop', stripe_connected: true }, error: null };
      return { data: null, error: null };
    }).then(resolve, reject); },
  };
  return q;
} };

const { insertLedgerRow } = load('src/lib/ledger-insert.ts', { '@/lib/supabase-admin': { supabaseAdmin: db } });
const base = { amount: 30, tax: 4.5, stripe_fee: 1.2, payment_intent_id: 'pi_1', stripe_session_id: 'cs_1', source: 'pos' };

(async () => {
  // 1. A missing optional column is dropped; the Stripe ids always survive.
  reset(['column "tax" of relation "transactions" does not exist', "Could not find the 'stripe_fee' column of 'transactions' in the schema cache"]);
  let res = await insertLedgerRow(base, ['tax', 'stripe_fee', 'source']);
  assert(!res.error);
  assert.equal(inserts.length, 3);
  assert(!('tax' in inserts[2]) && !('stripe_fee' in inserts[2]), 'optional columns dropped cumulatively');
  assert(inserts.every(r => r.payment_intent_id === 'pi_1' && r.stripe_session_id === 'cs_1'), 'Stripe ids never dropped');

  // 2. An error naming the payment id is returned — never retried without it.
  reset([PI_MISSING]);
  res = await insertLedgerRow(base, ['tax', 'stripe_fee', 'source']);
  assert.equal(res.error.message, PI_MISSING);
  assert.equal(inserts.length, 1, 'no ID-less retry');

  // 3. Unrelated errors stop immediately ("syntax" must not read as the tax column).
  reset(['invalid input syntax for type numeric: "abc"']);
  res = await insertLedgerRow(base, ['tax']);
  assert(res.error); assert.equal(inserts.length, 1);
  reset(['null value in column "client_name" violates not-null constraint']);
  res = await insertLedgerRow(base, ['tax', 'stripe_fee']);
  assert(res.error); assert.equal(inserts.length, 1, 'a column error naming a non-optional column is not retried');

  // 4. Terminal capture: failed save after a successful capture is recoverable
  //    by retrying the same PaymentIntent — no second capture, one ledger row.
  let piStatus, captures;
  const meta = { flow: 'pos_terminal_sale', shop_id: 'shop', subtotal: '30', tip: '0', tax: '4.5', discount: '0' };
  const stripe = { paymentIntents: {
    retrieve: async id => ({ id, status: piStatus, metadata: meta }),
    capture: async id => { captures++; piStatus = 'succeeded'; return { id, status: 'succeeded', metadata: meta }; },
  } };
  const common = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/stripe': { stripe, stripeFeeCents: async () => 120 },
    '@/lib/notify-server': { insertNotifications: () => {} },
    '@/lib/commission-server': { posCommissionFor: async () => 0 },
  };
  const terminal = load('src/app/api/stripe/terminal/capture/route.ts', { ...common, '@/lib/api-auth': { authorizeShop: async () => ({ isOwner: true, shop: { id: 'shop', owner_id: 'owner', stripe_account_id: 'acct_shop', stripe_connected: true } }) } });
  const capture = () => terminal.POST(new NextRequest('https://clipwise.ca/api/stripe/terminal/capture', { method: 'POST', body: JSON.stringify({ shop_id: 'shop', payment_intent_id: 'pi_tap' }) }));
  reset([PI_MISSING]); piStatus = 'requires_capture'; captures = 0;
  let r = await capture();
  assert.equal(r.status, 500, 'failed save surfaces');
  assert.equal(captures, 1);
  assert(inserts.every(x => x.payment_intent_id === 'pi_tap'), 'no ID-less terminal row');
  assert.equal(rows.length, 0);
  r = await capture();
  assert.equal(r.status, 200);
  assert.equal(captures, 1, 'retry never captures (charges) again');
  assert.equal(rows.length, 1); assert.equal(rows[0].payment_intent_id, 'pi_tap');
  r = await capture();
  assert.equal((await r.json()).transactionId, rows[0].id, 'third call is idempotent');
  assert.equal(rows.length, 1);

  // 5. POS Checkout finalize: same guarantee keyed on the Checkout session.
  const session = { payment_status: 'paid', payment_intent: 'pi_pos', metadata: { flow: 'pos_sale', shop_id: 'shop', subtotal: '30', tip: '0', tax: '4.5', total: '34.5' } };
  const posStripe = { checkout: { sessions: { retrieve: async () => session } } };
  const finalize = load('src/app/api/stripe/pos-finalize/route.ts', {
    ...common, '@/lib/stripe': { stripe: posStripe, stripeFeeCents: async () => 130 },
    '@/lib/promo': { fetchValidPromo: async () => null, consumePromo: async () => {} },
    '@/lib/loyalty-redeem': { redeemPointsForDiscount: async () => {} },
    '@/lib/clients-server': { upsertClient: async () => {} },
    '@/lib/payment-notify': { sendPaymentReceipt: async () => {} },
    '@/lib/pricing': {},
  });
  const fin = () => finalize.POST(new NextRequest('https://clipwise.ca/api/stripe/pos-finalize', { method: 'POST', body: JSON.stringify({ shop_id: 'shop', session_id: 'cs_pos' }) }));
  reset([PI_MISSING]);
  r = await fin();
  assert.equal(r.status, 500);
  assert(inserts.every(x => x.payment_intent_id === 'pi_pos'), 'no ID-less POS row');
  r = await fin();
  assert.equal(r.status, 200);
  assert.equal(rows.length, 1); assert.equal(rows[0].payment_intent_id, 'pi_pos'); assert.equal(rows[0].stripe_session_id, 'cs_pos');
  await fin();
  assert.equal(rows.length, 1, 'finalize retry is idempotent on the session');

  console.log('PASS ledger insert identity: optional columns only, Stripe ids never dropped, failed saves surface and a same-payment retry records once without re-capturing');
})().catch(error => { console.error(error); process.exitCode = 1; });
