const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript'), { NextRequest } = req('next/server');
let appt, shop, mode, sends, refunds, alerts, release;
function reset() { appt = { payment_status: 'paid', payment_intent_id: 'pi_old', client_email: 'saved@example.invalid', client_name: 'Client', date: '2026-09-20', total_amount: 100, shop_id: 'shop', barber_id: 'barber', services: { name: 'Cut' } }; shop = { name: 'Shop', email: 'shop@example.invalid', slug: 'shop', owner_id: 'owner', stripe_account_id: 'acct_fixture' }; mode = ''; sends = []; refunds = []; alerts = []; release = undefined; }
const event = { type: 'checkout.session.completed', data: { object: { payment_intent: 'pi_new', metadata: { flow: 'post_booking_payment', appointment_id: 'appt' } } } };
const mocks = {
  '@/lib/stripe': { stripe: { webhooks: { constructEvent() { if (mode === 'bad-signature') throw Error('invalid'); return event; } }, refunds: { create: async (...args) => { refunds.push(args); if (mode === 'refund-failed') throw Error('unavailable'); return {}; } } } },
  '@/lib/supabase-admin': { supabaseAdmin: { from(table) { const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: table === 'appointments' ? appt : shop, error: null }) }; return q; } } },
  '@/lib/payment-notify': { notifyDuplicatePayment: async data => alerts.push(data) },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (mode === 'held') await new Promise(resolve => { release = resolve; }); if (mode === 'email-throw') throw Error('offline'); return mode === 'email-error' ? { error: 'unavailable' } : { success: true }; } },
};
const file = path.join(root, 'src/app/api/webhooks/stripe/route.ts'), m = new Module(file, module);
m.require = id => mocks[id] ?? (id.startsWith('@/') ? {} : req(id));
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const call = (signature = 'fixture') => m.exports.POST(new NextRequest('https://clipwise.ca/api/webhooks/stripe', { method: 'POST', headers: signature ? { 'stripe-signature': signature } : {}, body: '{}' }));
global.fetch = async () => { throw Error('Unexpected HTTP hop'); };
(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  reset(); assert.equal((await call()).status, 200);
  assert.deepEqual(refunds, [[{ payment_intent: 'pi_new' }, { stripeAccount: 'acct_fixture', idempotencyKey: 'refund-dup-pi_new' }]]);
  assert.deepEqual(sends, [{ type: 'refund_issued', data: { clientName: 'Client', clientEmail: 'saved@example.invalid', shopName: 'Shop', shopEmail: 'shop@example.invalid', shopSlug: 'shop', serviceName: 'Cut', date: '2026-09-20', total: '$100.00' } }]);
  assert.equal(alerts[0].mode, 'auto_refunded');
  for (const failure of ['email-error', 'email-throw']) { reset(); mode = failure; assert.deepEqual(await (await call()).json(), { received: true }); assert.equal(refunds.length, 1); assert.equal(alerts[0].mode, 'auto_refunded'); }
  for (const state of ['refund-failed', 'no-account', 'no-email', 'cash']) { reset(); mode = state; if (state === 'no-account') shop.stripe_account_id = null; if (state === 'no-email') appt.client_email = null; if (state === 'cash') appt.payment_intent_id = null; assert.equal((await call()).status, 200); assert.equal(sends.length, 0); assert.equal(alerts[0].mode, state === 'cash' ? 'review' : state === 'no-email' ? 'auto_refunded' : 'refund_failed'); }
  reset(); mode = 'bad-signature'; assert.equal((await call()).status, 400); assert.equal(refunds.length, 0); assert.equal(sends.length, 0);
  reset(); assert.equal((await call('')).status, 400); assert.equal(refunds.length, 0);
  reset(); mode = 'held'; let done = false; const pending = call().then(r => { done = true; return r; }); for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof release, 'function'); assert.equal(done, false); release(); await pending;
  console.log('PASS webhook refund email: internal awaited delivery, canonical payload, preserved Connect/idempotency/signature/refund gates and email failure isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
