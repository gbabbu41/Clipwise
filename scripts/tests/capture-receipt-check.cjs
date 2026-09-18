const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript'), { NextRequest } = req('next/server');
let appt, mode, writes, charges, receipts, failures, release, sms = [];
function reset() { appt = { id: 'appt', shop_id: 'shop', barber_id: 'barber', service_id: 'service', client_name: 'Client', client_email: 'client@example.invalid', client_phone: null, date: '2026-09-18', time_slot: '10:00 AM', total_amount: 115, tax_amount: 15, tip_amount: 0, payment_status: 'held', payment_intent_id: 'pi_fixture' }; mode = ''; writes = []; charges = []; receipts = []; failures = []; release = undefined; }
const shop = { owner_id: 'owner', name: 'Shop', email: 'owner@example.invalid', slug: 'shop', stripe_account_id: 'acct_fixture', stripe_connected: true, booking_settings: {}, timezone: 'America/Halifax' };
const db = { auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: 'owner' } : null } }) }, from(table) { let patch; const q = { select() { return q; }, eq() { return q; }, in() { return q; }, limit() { return q; }, maybeSingle() { return q; }, update(value) { patch = value; writes.push({ table, value }); return q; }, insert(value) { patch = value; writes.push({ table, value }); return q; }, then(resolve, reject) { return Promise.resolve({ data: patch ? null : table === 'appointments' ? appt : table === 'shops' ? shop : table === 'services' ? { name: 'Cut' } : null, error: null }).then(resolve, reject); } }; return q; } };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { STRIPE_LIVE_MODE: true, stripeFeeCents: async () => 100, stripe: { paymentIntents: { retrieve: async () => ({ amount_capturable: 11500 }), capture: async (...args) => { charges.push(args); return { id: 'pi_fixture', amount_received: 11500 }; } } } },
  '@/lib/payment-notify': { sendPaymentReceipt: async (...args) => { receipts.push(args); if (mode === 'held') await new Promise(resolve => { release = resolve; }); if (mode === 'throw') throw Error('receipt offline'); }, notifyChargeFailed: data => failures.push(data), notifyNoShowCharged: () => {} },
  '@/lib/twilio': { sendSmsBestEffort: async (...args) => { sms.push(args); } }, '@/lib/utils': { prettyDate: v => v, isCheckoutAllowed: () => true, CHECKOUT_LEAD_HOURS: 2 }, '@/lib/timezone': { safeTz: v => v, todayInTz: () => '2026-09-18', nowMinutesInTz: () => 600 }, '@/lib/validation': { NO_SHOW_MAX_PCT: 100, noShowFeeCents: total => total },
};
const file = path.join(root, 'src/app/api/stripe/capture-appointment/route.ts'), m = new Module(file, module); m.require = id => mocks[id] ?? req(id); m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const call = (reason = 'completed', token = 'valid') => m.exports.POST(new NextRequest('https://clipwise.ca/api/stripe/capture-appointment', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.invalid' }, body: JSON.stringify({ appointment_id: 'appt', reason }) }));
(async () => {
  for (const reason of ['completed', 'no_show']) {
    reset(); mode = 'throw'; const r = await call(reason); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, amount: 115 }); assert.equal(charges.length, 1); assert.deepEqual(charges[0], ['pi_fixture', {}, { stripeAccount: 'acct_fixture' }]); assert.equal(receipts.length, 1); assert.equal(failures.length, 0); assert.ok(!writes.some(w => w.value.payment_status === 'failed'));
    const tx = writes.find(w => w.table === 'transactions').value; assert.equal(tx.amount, reason === 'completed' ? 100 : 115); assert.equal(tx.tax, reason === 'completed' ? 15 : 0); assert.equal(tx.tip, 0); assert.equal(receipts[0][1].amountCents, 11500); assert.equal(receipts[0][1].taxCents, reason === 'completed' ? 1500 : 0);
  }
  reset(); mode = 'held'; let done = false; const pending = call().then(r => { done = true; return r; }); for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof release, 'function'); assert.equal(done, false); assert.equal(charges.length, 1); release(); assert.equal((await pending).status, 200); assert.equal(receipts.length, 1);
  reset(); appt.payment_status = 'captured'; assert.deepEqual(await (await call()).json(), { ok: true, alreadyCaptured: true }); assert.equal(receipts.length, 0); assert.equal(charges.length, 0);
  reset(); assert.equal((await call('completed', 'bad')).status, 401); assert.equal(charges.length, 0); assert.equal(receipts.length, 0);
  for (const configured of ['https://preview.example.invalid/', 'http://localhost:3000', undefined, '']) {
    if (configured === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = configured;
    const expected = configured ? configured.replace(/\/+$/, '') : 'https://clipwise.ca';
    reset(); sms = []; await call('completed'); assert.equal(receipts[0][0], expected); assert.equal(receipts[0][1].bookingUrl, `${expected}/book/shop`); assert.ok(sms[0][1].endsWith(`${expected}/tip/appt`)); assert.ok(!sms[0][1].includes('attacker.invalid'));
    reset(); sms = []; await call('no_show'); assert.equal(receipts[0][1].bookingUrl, `${expected}/book/shop`); assert.equal(receipts[0][1].noShow, true); assert.ok(!sms[0][1].includes('/tip/')); assert.equal(charges.length, 1);
  }
  console.log('PASS capture receipt: waits for one attempt, email rejection preserves successful charge, totals/Connect/ledger unchanged, already-paid and auth gates preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
