const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript'), { NextRequest } = req('next/server');
let mode, sends, writes, receipts, completions, release, lane;
const appt = { id: 'appt', status: 'pending', payment_status: 'unpaid', shop_id: 'shop', barber_id: 'barber', client_name: 'Client', client_email: 'client@example.invalid', date: '2026-09-20', time_slot: '10:00 AM', total_amount: 115, tax_amount: 15, services: { name: 'Cut' } };
let shop;
function reset(target) { lane = target; mode = ''; sends = []; writes = []; receipts = []; completions = []; release = undefined; shop = { name: 'Shop', email: 'owner@example.invalid', owner_id: 'owner', stripe_account_id: 'acct_fixture', stripe_connected: true }; }
const db = { from(table) { let patch, inserted = false, single = false; const q = { select() { return q; }, eq() { return q; }, neq() { return q; }, in() { return q; }, limit() { return q; }, maybeSingle() { single = true; return q; }, update(value) { patch = value; writes.push({ table, value }); return q; }, insert(value) { inserted = true; writes.push({ table, value }); return q; }, then(resolve, reject) { let data = null; if (table === 'shops') data = shop; if (table === 'appointments') data = patch ? patch.payment_status ? mode === 'duplicate' ? single ? null : [] : single ? appt : [{ id: 'appt' }] : null : appt; if (table === 'transactions' && !inserted) data = mode === 'duplicate' ? single ? { id: 'existing' } : [{ id: 'existing' }] : single ? null : []; return Promise.resolve({ data, error: null }).then(resolve, reject); } }; return q; } };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { stripeFeeCents: async () => 100, stripe: { webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', account: 'acct_fixture', data: { object: { payment_intent: 'pi_fixture', metadata: { flow: lane === 'balance' ? 'balance' : 'post_booking_payment', appointment_id: 'appt', shop_id: 'shop', bal_service: '100', bal_tax: '15' } } } }) } } },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (mode === 'held') await new Promise(resolve => { release = resolve; }); if (mode === 'throw') throw Error('offline'); return mode === 'error' ? { error: 'unavailable' } : { success: true }; } },
  '@/lib/payment-notify': { sendPaymentReceipt: async (...args) => receipts.push(args), notifyNoShowCharged: () => {}, notifyBalancePaid: () => {} },
  '@/lib/completion-server': { runServerCompletionEffects: async data => completions.push(data) },
  '@/lib/finalize-appointment-payment': { recordOnlinePaymentTx: async data => writes.push({ table: 'ledger', value: data }) },
};
function load(relative) { const file = path.join(root, relative), m = new Module(file, module); m.require = id => mocks[id] ?? (id.startsWith('@/') ? {} : req(id)); m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports; }
const finalizer = load('src/lib/finalize-appointment-payment.ts'), webhook = load('src/app/api/webhooks/stripe/route.ts');
const call = (completeOnPaid = false) => lane === 'finalizer' ? finalizer.markAppointmentPaid({ appt, shop, baseUrl: 'https://attacker.invalid', paymentIntentId: 'pi_fixture', completeOnPaid }) : webhook.POST(new NextRequest('https://clipwise.ca/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'fixture' }, body: '{}' }));
global.fetch = async () => { throw Error('Unexpected email HTTP hop'); };
(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  for (const target of ['finalizer', 'balance', 'webhook']) {
    reset(target); const result = await call(); assert.equal(target === 'finalizer' ? result : result.status, target === 'finalizer' ? true : 200);
    assert.deepEqual(sends, [{ type: 'owner_payment_received', data: { ownerEmail: 'owner@example.invalid', clientName: 'Client', serviceName: target === 'balance' ? 'Cut (balance)' : 'Cut', amount: '$115.00', date: '2026-09-20', time: '10:00 AM' } }]); assert.equal(receipts.length, 1);
    const ledger = writes.find(w => w.table === 'transactions' || w.table === 'ledger'); assert.ok(ledger); assert.equal(ledger.value.amount ?? ledger.value.amountDollars, 100); assert.equal(ledger.value.tax ?? ledger.value.taxDollars, 15);
    for (const failure of ['error', 'throw']) { reset(target); mode = failure; const r = await call(); assert.equal(target === 'finalizer' ? r : r.status, target === 'finalizer' ? true : 200); }
    reset(target); shop.email = null; await call(); assert.equal(sends.length, 0); assert.equal(receipts.length, 1);
    reset(target); mode = 'duplicate'; await call(); assert.equal(sends.length, 0); assert.equal(receipts.length, 0);
    reset(target); mode = 'held'; let done = false; const pending = call().then(() => { done = true; }); for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof release, 'function'); assert.equal(done, false); release(); await pending;
  }
  reset('finalizer'); mode = 'throw'; await call(true); assert.equal(completions.length, 1); assert.equal(writes[0].value.status, 'completed');
  console.log('PASS owner payment email: three internal awaited senders, canonical payloads, preserved ledger totals/claim gates, missing contact, delivery failures and completion effects');
})().catch(error => { console.error(error); process.exitCode = 1; });
