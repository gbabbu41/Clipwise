const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript'), { NextRequest } = req('next/server');
let appt, owner, mode, released, refunds, sends, writes, ledger, waitlist, release;
function reset() { appt = { id: 'appt', shop_id: 'shop', barber_id: 'barber', payment_intent_id: 'pi_fixture', payment_status: 'paid', status: 'confirmed', client_name: 'Client', client_email: 'saved@example.invalid', date: '2026-09-20', total_amount: 100, tax_amount: 0, tip_amount: 0, services: { name: 'Cut' } }; owner = 'owner'; mode = ''; released = false; refunds = []; sends = []; writes = []; ledger = []; waitlist = []; release = undefined; }
const db = { auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: 'owner' } : null }, error: null }) }, from(table) { let patch; const q = { select() { return q; }, eq() { return q; }, neq() { return q; }, single() { return q; }, update(value) { patch = value; writes.push({ table, value }); return q; }, then(yes, no) { return Promise.resolve({ error: null, data: patch ? null : table === 'appointments' ? appt : { id: 'shop', owner_id: owner, name: 'Shop', email: 'shop@example.invalid', slug: 'shop', stripe_account_id: 'acct_fixture' } }).then(yes, no); } }; return q; } };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/stripe': { stripe: {} },
  '@/lib/stripe-refund': { refundOrReleaseHold: async (...args) => { refunds.push(args); if (mode === 'refund-error') throw Error('provider rejected'); return { released, refundedCents: released ? 0 : 2500 }; }, isAlreadyRefunded: () => false },
  '@/lib/refund-ledger': { recordRefundLedger: async args => ledger.push(args) }, '@/lib/payment-notify': { notifyRefundIssued: () => {} }, '@/lib/waitlist-notify-server': { notifyWaitlistForSlot: async args => waitlist.push(args) },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (mode === 'held') await new Promise(resolve => { release = resolve; }); if (mode === 'throw') throw Error('offline'); return mode === 'error' ? { error: 'unavailable' } : { success: true }; } },
};
function load(route) { const file = path.join(root, `src/app/api/stripe/${route}/route.ts`), m = new Module(file, module); m.require = id => mocks[id] ?? req(id); m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports.POST; }
const request = (token = 'valid') => new NextRequest('https://clipwise.ca/api/test', { method: 'POST', headers: { Origin: 'https://attacker.invalid', Authorization: `Bearer ${token}` }, body: JSON.stringify({ appointment_id: 'appt' }) });
global.fetch = async () => { throw Error('Unexpected HTTP email hop'); };
(async () => {
  for (const route of ['refund', 'refund-payment']) {
    const POST = load(route);
    for (const state of ['confirmed', 'completed', 'no-show']) {
      reset(); appt.status = state; const result = await POST(request()); assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true, released: false });
      assert.deepEqual(refunds, [['pi_fixture', 'acct_fixture', 'refund-appt-pi_fixture']]); assert.equal(ledger[0].refundedCents, 2500); assert.equal(waitlist.length, state === 'confirmed' ? 1 : 0);
      assert.deepEqual(writes[0].value, state === 'confirmed' ? { status: 'cancelled', payment_status: 'refunded' } : { payment_status: 'refunded' });
      assert.deepEqual(sends, [{ type: 'refund_issued', data: { clientName: 'Client', clientEmail: 'saved@example.invalid', shopName: 'Shop', shopEmail: 'shop@example.invalid', shopSlug: 'shop', serviceName: 'Cut', date: '2026-09-20', total: '$25.00' } }]);
    }
    for (const failure of ['throw', 'error']) { reset(); mode = failure; const r = await POST(request()); assert.equal(r.status, 200); assert.equal((await r.json()).ok, true); assert.equal(refunds.length, 1); }
    reset(); released = true; assert.equal((await (await POST(request())).json()).released, true); assert.equal(sends.length, 0); assert.equal(ledger.length, 0); assert.equal(waitlist.length, 1);
    reset(); appt.client_email = null; await POST(request()); assert.equal(sends.length, 0);
    for (const gate of ['auth', 'owner', 'refunded', 'refund-error']) { reset(); if (gate === 'owner') owner = 'other'; if (gate === 'refunded') appt.payment_status = 'refunded'; mode = gate; assert.ok((await POST(request(gate === 'auth' ? 'invalid' : 'valid'))).status >= 400); assert.equal(sends.length, 0); assert.equal(ledger.length, 0); }
    reset(); mode = 'held'; let done = false; const pending = POST(request()).then(r => { done = true; return r; }); for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof release, 'function'); assert.equal(done, false); release(); await pending; assert.equal(done, true);
  }
  console.log('PASS refund email: awaited internal delivery, preserved actual amount/recipient, no email for released holds/missing contact, email failure preserves refund success, unchanged served/waitlist/owner gates');
})().catch(error => { console.error(error); process.exitCode = 1; });
