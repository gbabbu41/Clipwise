const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript'), { NextRequest, NextResponse } = req('next/server');
let sessions, sends, writes, sms, mode, denied, paidPlan, connected, appt, release;
function reset() { sessions = []; sends = []; writes = []; sms = []; mode = ''; denied = false; paidPlan = true; connected = true; appt = { id: 'appt', shop_id: 'shop', barber_id: 'barber', service_id: 'service', client_name: 'Client', client_email: 'saved@example.invalid', client_phone: '+15555550100', date: '2026-09-20', time_slot: '10:00', total_amount: 115, tax_amount: 15, balance_due: 57.5, payment_status: 'unpaid', services: { name: 'Cut' } }; }
const db = { from(table) { let patch; const q = { select() { return q; }, eq() { return q; }, single() { return q; }, maybeSingle() { return q; }, update(value) { patch = value; writes.push(value); return q; }, then(yes, no) {
  return Promise.resolve({ error: null, data: patch ? null : table === 'appointments' ? appt : table === 'services' ? { name: 'Cut' } : { name: 'Shop', slug: 'shop', email: 'shop@example.invalid', stripe_account_id: 'acct_fixture', stripe_connected: connected, subscription_plan: 'pro', subscription_status: 'active', booking_settings: {} } }).then(yes, no);
} }; return q; } };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/api-auth': { authorizeAppointment: async (request, id, opts) => { assert.equal(id, 'appt'); assert.equal(opts.permission, 'manage_appointments'); return denied ? { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } : { appointment: appt }; } },
  '@/lib/validation': { effectivePlan: () => 'pro', planHasFeature: () => paidPlan }, '@/lib/plans-server': { ensurePlansHydrated: async () => {} },
  '@/lib/pricing': { taxOnAmount: amount => amount * 0.15, taxLabelDetailed: () => 'HST (15%)' },
  '@/lib/twilio': { sendSmsBestEffort: async (...args) => sms.push(args) },
  '@/lib/stripe': { stripe: { checkout: { sessions: { create: async (args, options) => { sessions.push({ args, options }); return { id: 'cs_fixture', url: 'https://checkout.stripe.com/fixture', payment_intent: 'pi_fixture' }; } } } } },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (mode === 'held') await new Promise(resolve => { release = resolve; }); if (mode === 'throw') throw Error('offline'); return mode === 'error' ? { error: 'unavailable' } : { success: true }; } },
};
function load(route) { const file = path.join(root, `src/app/api/stripe/${route}/route.ts`), m = new Module(file, module); m.require = id => mocks[id] ?? req(id); m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports.POST; }
const request = (extra = {}) => new NextRequest('https://clipwise.ca/api/test', { method: 'POST', headers: { Origin: 'https://attacker.invalid', Authorization: 'Bearer fixture-secret' }, body: JSON.stringify({ appointment_id: 'appt', send_email: true, ...extra }) });
global.fetch = async () => { throw Error('Unexpected outbound HTTP hop'); };
(async () => {
  for (const route of ['payment-link', 'balance-link']) {
    const POST = load(route);
    for (const base of [undefined, 'https://configured.example.invalid///']) {
      reset(); if (base) process.env.NEXT_PUBLIC_APP_URL = base; else delete process.env.NEXT_PUBLIC_APP_URL;
      const response = await POST(request({ email: ' override@example.invalid ', send_sms: true, phone: '+15555550101', complete_on_paid: true })), body = await response.json();
      assert.equal(response.status, 200); assert.equal(body.emailed, true); assert.equal(body.texted, true); assert.equal(body.url, 'https://checkout.stripe.com/fixture'); assert.equal(sessions.length, 1);
      const checkout = sessions[0]; assert.equal(checkout.options.stripeAccount, 'acct_fixture'); assert.ok(checkout.args.success_url.startsWith((base ? 'https://configured.example.invalid' : 'https://clipwise.ca') + '/book/shop?')); assert.doesNotMatch(checkout.args.cancel_url, /attacker|\/\/\/book/);
      assert.deepEqual(checkout.args.line_items.map(x => x.price_data.unit_amount), route === 'payment-link' ? [10000, 1500] : [5000, 750]);
      assert.equal(checkout.args.metadata.flow, route === 'payment-link' ? 'post_booking_payment' : 'balance'); assert.equal(checkout.args.metadata.appointment_id, 'appt');
      assert.equal(sends.length, 1); assert.equal(sends[0].type, 'payment_link'); assert.equal(sends[0].data.clientEmail, 'override@example.invalid'); assert.equal(sends[0].data.paymentUrl, body.url); assert.equal(Number(sends[0].data.amount), route === 'payment-link' ? 115 : 57.5); assert.equal(sms[0][0], '+15555550101');
      assert.equal(route === 'payment-link' ? writes.some(x => x.client_email === 'override@example.invalid') : writes.length === 0, true);
      assert.doesNotMatch(JSON.stringify(sends), /fixture-secret|attacker/);
    }
    for (const failure of ['error', 'throw']) { reset(); mode = failure; const result = await POST(request()); assert.equal(result.status, 200); assert.equal((await result.json()).emailed, false); assert.equal(sessions.length, 1); }
    reset(); await POST(request({ send_email: false })); assert.equal(sends.length, 0);
    reset(); appt.client_name = null; appt.date = null; appt.time_slot = null; assert.equal((await POST(request())).status, 200); assert.equal(sends[0].data.clientName, ''); assert.equal(sends[0].data.date, ''); assert.equal(sends[0].data.time, '');
    for (const gate of ['denied', 'plan', 'connect', 'amount']) { reset(); denied = gate === 'denied'; paidPlan = gate !== 'plan'; connected = gate !== 'connect'; if (gate === 'amount') { appt.balance_due = 0; appt.total_amount = 0; } const result = await POST(request()); assert.ok(result.status >= 400); assert.equal(sessions.length, 0); assert.equal(sends.length, 0); }
    reset(); mode = 'held'; let done = false; const pending = POST(request()).then(r => { done = true; return r; }); for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false); assert.equal(typeof release, 'function'); release(); await pending; release = undefined;
  }
  console.log('PASS payment emails: no Origin HTTP hop, trusted checkout returns, awaited direct sends, delivery failures preserve checkout, existing amounts/metadata/Connect/contact overrides and gates');
})().catch(error => { console.error(error); process.exitCode = 1; });
