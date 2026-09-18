const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript');
const { NextRequest } = appReq('next/server');
let rows, readFailure, writeFailure, providerFailure, calls, beforeWrite, sent;
function reset() {
  rows = ['a', 'b'].map(id => ({ id, owner_id: 'owner', subscription_plan: 'premium', subscription_status: 'active', stripe_subscription_id: 'shared', trial_ends_at: null }));
  rows.push({ ...rows[0], id: 'foreign', owner_id: 'other' });
  readFailure = writeFailure = providerFailure = false;
  calls = []; beforeWrite = null; sent = 0;
}
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: 'owner' } : null } }) },
  from() {
    let filters = [], values, take = Infinity;
    const q = {
      select() { return q; }, order() { return q; }, limit(n) { take = n; return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; }, is(k, v) { filters.push(r => r[k] === v); return q; },
      update(v) { values = v; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (values && beforeWrite) { const f = beforeWrite; beforeWrite = null; f(); }
          if (values ? writeFailure : readFailure) return { data: null, error: { message: 'unavailable' } };
          const found = rows.filter(r => filters.every(f => f(r))).slice(0, take);
          if (values) found.forEach(r => Object.assign(r, values));
          return { data: found.map(r => ({ ...r })), error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  },
};
const stripe = { subscriptions: {
  async cancel(id) { calls.push(['cancel', id]); if (providerFailure) throw Error('provider unavailable'); return { id }; },
  async update(id, values) { calls.push(['update', id, values]); if (providerFailure) throw Error('provider unavailable'); return { items: { data: [{ current_period_end: 1800000000 }] } }; },
} };
const billingTypes = new Set(['subscription_started', 'subscription_cancelled', 'subscription_payment_failed', 'subscription_renewal_reminder']);
const mocks = {
  '@/lib/admin-auth': { requireSuperAdmin: async () => { throw Error('Billing notices must not enter admin-notification authorization'); } },
  '@/lib/api-auth': { authorizeShop: async () => { throw Error('Billing notices must be rejected before shop authorization'); } },
  '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/stripe': { stripe },
  '@/lib/native-app': { isNativeRequest: r => r.headers.get('user-agent') === 'ClipWiseApp' },
  '@/lib/emailer': { SERVER_ONLY_EMAIL_TYPES: billingTypes, PRIVILEGED_EMAIL_TYPES: billingTypes, sendAppEmail: async () => { sent++; return {}; } },
  '@/lib/validation': {}, '@/lib/plans-server': {}, '@/lib/rate-limit': { enforceRateLimit: () => null },
};
function load(route) {
  const filename = path.join(root, 'src/app/api', route, 'route.ts');
  const m = new Module(filename, module); m.filename = filename; m.require = id => mocks[id] ?? appReq(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports.POST;
}
const cancel = load('stripe/cancel-subscription'), resume = load('stripe/resume-subscription'), email = load('send-email');
const req = (body = {}, token = 'valid', native = false) => new NextRequest('https://clipwise.ca/api/test', { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(native ? { 'user-agent': 'ClipWiseApp' } : {}) }, body: JSON.stringify(body) });
(async () => {
  for (const route of [cancel, resume]) {
    reset(); assert.equal((await route(req({}, 'bad'))).status, 401);
    assert.equal((await route(req({}, 'valid', true))).status, 403);
    for (const body of [null, [], 42, { shop_id: 7 }, { shop_id: '' }]) assert.equal((await route(req(body))).status, 400);
    reset(); readFailure = true; assert.equal((await route(req())).status, 503); assert.equal(calls.length, 0);
    reset(); assert([400, 404].includes((await route(req({ shop_id: 'foreign' }))).status)); assert.equal(calls.length, 0);
  }
  reset(); assert.equal((await cancel(req({ immediate: 'false' }))).status, 400); assert.equal(calls.length, 0);
  reset(); assert.equal((await cancel(req({ shop_id: 'a', immediate: true }))).status, 200);
  assert.deepEqual(calls, [['cancel', 'shared']]); assert(rows.slice(0, 2).every(r => r.subscription_plan === 'starter' && r.stripe_subscription_id === null));
  assert.equal(rows[2].subscription_plan, 'premium');
  reset(); providerFailure = true; assert.equal((await cancel(req({ immediate: true }))).status, 502); assert.equal(rows[0].subscription_plan, 'premium');
  reset(); writeFailure = true; assert.equal((await cancel(req({ immediate: true }))).status, 500);
  reset(); beforeWrite = () => { rows[1].stripe_subscription_id = 'replacement'; };
  assert.equal((await cancel(req({ immediate: true }))).status, 200); assert.equal(rows[1].subscription_plan, 'premium');
  reset(); const scheduled = await (await cancel(req({ immediate: false }))).json(); assert.equal(scheduled.scheduled, true); assert.equal(scheduled.endsAt, new Date(1800000000000).toISOString()); assert.equal(rows[0].subscription_plan, 'premium');
  reset(); assert.equal((await resume(req({ shop_id: 'a' }))).status, 200); assert.deepEqual(calls, [['update', 'shared', { cancel_at_period_end: false }]]);
  reset(); rows.slice(0, 2).forEach(r => Object.assign(r, { stripe_subscription_id: null, trial_ends_at: '2026-10-01T00:00:00Z', trial_used: true }));
  assert.equal((await cancel(req({ immediate: false }))).status, 200); assert.equal(calls.length, 0); assert.equal(rows[0].subscription_plan, 'premium');
  assert.equal((await cancel(req({ immediate: true }))).status, 200); assert(rows.slice(0, 2).every(r => r.subscription_plan === 'starter' && r.trial_used && r.trial_ended_at));
  reset(); rows[0].stripe_subscription_id = null; beforeWrite = () => { rows[0].stripe_subscription_id = 'paid'; };
  assert.equal((await cancel(req({ immediate: true }))).status, 409); assert.equal(rows[0].subscription_plan, 'premium');
  reset(); rows[0].stripe_subscription_id = null; assert.equal((await cancel(req())).status, 200); assert.equal(rows[0].subscription_plan, 'starter'); assert.equal(rows[1].subscription_plan, 'premium');
  process.env.RESEND_API_KEY = 'test-placeholder';
  for (const type of billingTypes) { assert.equal((await email(req({ type, data: { ownerEmail: 'qa@example.invalid' } }))).status, 403); }
  assert.equal(sent, 0);
  const emailSource = fs.readFileSync(path.join(root, 'src/lib/emailer.ts'), 'utf8');
  for (const type of billingTypes) assert(emailSource.slice(emailSource.indexOf('SERVER_ONLY_EMAIL_TYPES'), emailSource.indexOf('PRIVILEGED_EMAIL_TYPES')).includes(`"${type}"`));
  console.log('PASS cancellation/resume input/auth/native/read failures, shared paid/trial cancellation, concurrent replacement protection, provider failure, scheduled access, comped plan and server-only billing email guards');
})().catch(e => { console.error(e); process.exitCode = 1; });
