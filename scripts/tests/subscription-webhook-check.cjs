const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript');
const { NextRequest } = appReq('next/server');
let event, rows, subs, writes, reads, cleanup, emails, failure, addonCalls;
function reset(type = 'checkout.session.completed') {
  event = { type, data: { object: { id: 'session1', mode: 'subscription', customer: 'cus1', subscription: 'sub1', metadata: { user_id: 'owner', plan: 'stale' } } } };
  rows = [{ id: 'shop1', owner_id: 'owner', name: 'QA', email: 'qa@example.invalid', stripe_customer_id: 'cus1', stripe_subscription_id: null, subscription_plan: 'starter', subscription_status: 'active', trial_ends_at: 'future' }];
  subs = { sub1: { id: 'sub1', status: 'active', customer: 'cus1', metadata: { user_id: 'owner', plan: 'pro' } } };
  writes = 0; reads = 0; cleanup = []; emails = []; failure = null; addonCalls = [];
}
const db = { from(table) {
  assert.equal(table, 'shops');
  let values, filters = [], one = false;
  const q = {
    select() { return q; }, limit() { return q; }, maybeSingle() { one = true; return q; },
    eq(k, v) { filters.push([k, v]); return q; },
    update(v) { values = v; return q; },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        if (failure === (values ? 'write' : 'read')) return { data: null, error: { message: 'DB unavailable' } };
        const found = rows.filter(r => filters.every(([k, v]) => r[k] === v));
        if (values) { writes++; found.forEach(r => Object.assign(r, values)); }
        else reads++;
        return { data: one ? found[0] ?? null : found.map(r => ({ ...r })), error: null };
      }).then(resolve, reject);
    },
  };
  return q;
} };
const stripe = { webhooks: { constructEvent() { if (failure === 'signature') throw Error('Invalid'); return event; } }, subscriptions: { async retrieve(id) { if (!subs[id]) throw Error('Stripe unavailable'); return subs[id]; } } };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { stripe },
  '@/lib/plans-server': { ensurePlansHydrated: async () => [] },
  '@/lib/validation': { getLocationLimit: () => 1 },
  '@/lib/stripe-addons': { reconcileLocationAddon: async (...args) => { if (failure === 'addon') throw Error('Addon unavailable'); addonCalls.push(args); }, reconcileAiPhoneAddon: async (...args) => addonCalls.push(args) },
  '@/lib/stripe-subscription': { cancelDuplicateSubscriptions: async (...args) => cleanup.push(args) },
  '@/lib/emailer': { sendAppEmail: async (...args) => emails.push(args) },
};
const filename = path.join(root, 'src/app/api/webhooks/stripe/route.ts');
const m = new Module(filename, module);
m.filename = filename;
m.require = id => mocks[id] ?? (id.startsWith('@/') ? {} : appReq(id));
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock_only';
const req = () => new NextRequest('https://example.invalid/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'test' }, body: '{}' });
async function run(status = 200) { assert.equal((await m.exports.POST(req())).status, status); }
async function ignored() { await run(); assert.equal(writes, 0); assert.equal(cleanup.length, 0); assert.equal(addonCalls.length, 0); }
(async () => {
  reset(); failure = 'signature'; await run(400);
  for (const type of ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.upcoming', 'invoice.payment_failed']) {
    reset(type); event.account = 'acct_connected'; await ignored(); assert.equal(reads, 0); assert.equal(emails.length, 0);
  }
  for (const status of ['canceled', 'incomplete_expired', 'incomplete', 'past_due', 'unpaid']) { reset(); subs.sub1.status = status; await ignored(); }
  reset(); subs.sub1.metadata.user_id = 'foreign'; await ignored();
  reset(); subs.sub1.customer = 'foreign'; await ignored();
  reset(); rows[0].stripe_customer_id = 'foreign'; await ignored();
  reset(); rows[0].stripe_subscription_id = 'newer'; subs.newer = { status: 'active' }; await ignored();
  reset(); rows.push({ ...rows[0], id: 'shop2', stripe_subscription_id: 'newer' }); subs.newer = { status: 'trialing' }; await ignored();
  for (const fail of ['read', 'write']) { reset(); failure = fail; await run(500); assert.equal(cleanup.length, 0); }
  reset(); delete subs.sub1; await run(500); assert.equal(writes, 0);
  reset(); rows = []; await run(500); assert.equal(cleanup.length, 0);
  reset(); rows.push({ ...rows[0], id: 'shop2', ai_phone_plan_active: true }); rows.forEach(r => r.stripe_subscription_id = 'old'); event.data.object.metadata.old_subscription_id = 'old';
  await run(); assert.ok(rows.every(r => r.stripe_subscription_id === 'sub1' && r.subscription_plan === 'pro' && r.trial_ends_at === null)); assert.deepEqual(cleanup[0], ['cus1', 'sub1', 'old']); assert.deepEqual(addonCalls, [['sub1', 1], ['sub1', true]]);
  reset(); failure = 'addon'; await run(500);
  reset('customer.subscription.updated'); event.data.object = { id: 'sub1', status: 'past_due' }; rows[0].stripe_subscription_id = 'sub1'; await run(); assert.equal(rows[0].subscription_status, 'active');
  subs.sub1.status = 'past_due'; event.data.object.status = 'active'; await run(); assert.equal(rows[0].subscription_status, 'past_due');
  rows[0].stripe_subscription_id = 'replacement'; subs.sub1.status = 'canceled'; await run(); assert.equal(rows[0].subscription_status, 'past_due');
  reset('customer.subscription.updated'); event.data.object = { id: 'sub1' }; failure = 'write'; await run(500);
  reset('customer.subscription.deleted'); event.data.object = { id: 'sub1' }; rows[0].stripe_subscription_id = 'sub1'; rows.push({ ...rows[0], id: 'shop2' }, { ...rows[0], id: 'shop3', stripe_subscription_id: 'replacement' });
  await run(); assert.ok(rows.slice(0, 2).every(r => r.subscription_plan === 'starter' && r.subscription_status === 'cancelled' && r.stripe_subscription_id === null && r.trial_ends_at === null)); assert.equal(rows[2].stripe_subscription_id, 'replacement'); assert.equal(rows[2].subscription_status, 'active'); assert.equal(emails.length, 1); await run(); assert.equal(emails.length, 1);
  reset('customer.subscription.deleted'); event.data.object = { id: 'sub1' }; failure = 'write'; await run(500); assert.equal(emails.length, 0);
  for (const type of ['invoice.upcoming', 'invoice.payment_failed']) { reset(type); event.data.object = { customer: 'cus1', amount_due: 1000 }; await run(); assert.equal(emails.length, 1); }
  console.log('PASS subscription webhook stale checkout/status guards, account isolation, database retries, all-location deletion, replacement safety, add-ons and direct emails');
})().catch(e => { console.error(e); process.exitCode = 1; });
