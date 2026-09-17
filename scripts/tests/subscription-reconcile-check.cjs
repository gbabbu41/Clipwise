const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript');
let rows, status, failure, retrieved, changedDuringRead;
function reset() {
  rows = [{ id: 'shop1', stripe_subscription_id: 'sub1', subscription_status: 'active', subscription_plan: 'pro', trial_ends_at: 'future' }];
  status = 'active'; failure = null; retrieved = 0; changedDuringRead = false;
}
const db = { from() {
  let filters = [], values;
  const q = {
    select() { return q; },
    not(k, op, v) { filters.push(r => r[k] !== v); return q; },
    eq(k, v) { filters.push(r => r[k] === v); return q; },
    neq(k, v) { filters.push(r => r[k] !== v); return q; },
    in(k, v) { filters.push(r => v.includes(r[k])); return q; },
    update(v) { values = v; return q; },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (failure === (values ? 'write' : 'read')) return { data: null, error: new Error('DB failed') };
      const found = rows.filter(r => filters.every(f => f(r)));
      if (values) found.forEach(r => Object.assign(r, values));
      return { data: found.map(r => ({ ...r })), error: null };
    }).then(resolve, reject); },
  };
  return q;
} };
const stripe = { subscriptions: { async retrieve() {
  retrieved++;
  if (changedDuringRead) { rows[0].stripe_subscription_id = 'replacement'; rows[0].subscription_status = 'active'; }
  if (failure === 'network') throw new Error('Temporary Stripe outage');
  if (failure === 'missing') throw { code: 'resource_missing' };
  if (failure === 'rate_limit') throw { statusCode: 429 };
  return { status };
} } };
const filename = path.join(root, 'src/lib/reconcile-subscriptions.ts'), m = new Module(filename, module);
m.filename = filename;
m.require = id => id === './stripe' ? { stripe } : id === './supabase-admin' ? { supabaseAdmin: db } : appReq(id);
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const run = m.exports.reconcileSubscriptions;
(async () => {
  reset(); rows = []; assert.deepEqual(await run(), { checked: 0, downgraded: 0, corrected: 0 });
  reset(); failure = 'read'; await assert.rejects(run); assert.equal(retrieved, 0);
  for (const s of ['active', 'trialing', 'paused', 'incomplete']) { reset(); status = s; assert.equal((await run()).corrected, 0); assert.equal(rows[0].subscription_plan, 'pro'); }
  for (const s of ['canceled', 'incomplete_expired']) {
    reset(); status = s; rows.push({ ...rows[0], id: 'shop2', subscription_status: 'cancelled' });
    assert.deepEqual(await run(), { checked: 1, downgraded: 2, corrected: 0 }); assert.equal(retrieved, 1);
    assert.ok(rows.every(r => r.stripe_subscription_id === null && r.trial_ends_at === null && r.subscription_plan === 'starter'));
    assert.deepEqual(await run(), { checked: 0, downgraded: 0, corrected: 0 });
  }
  for (const s of ['past_due', 'unpaid']) {
    reset(); status = s; rows.push({ ...rows[0], id: 'shop2', subscription_status: 'past_due' });
    assert.deepEqual(await run(), { checked: 1, downgraded: 0, corrected: 1 });
    assert.equal((await run()).corrected, 0);
  }
  reset(); rows[0].subscription_status = 'past_due'; rows.push({ ...rows[0], id: 'shop2', subscription_status: 'cancelled' });
  assert.equal((await run()).corrected, 1); assert.equal(rows[1].subscription_status, 'cancelled');
  for (const fail of ['network', 'rate_limit']) { reset(); failure = fail; const before = JSON.stringify(rows); assert.equal((await run()).downgraded, 0); assert.equal(JSON.stringify(rows), before); }
  reset(); failure = 'missing'; assert.equal((await run()).downgraded, 1);
  for (const s of ['canceled', 'past_due', 'active']) {
    reset(); status = s; rows[0].subscription_status = 'past_due'; changedDuringRead = true;
    assert.deepEqual(await run(), { checked: 1, downgraded: 0, corrected: 0 });
    assert.equal(rows[0].stripe_subscription_id, 'replacement'); assert.equal(rows[0].subscription_plan, 'pro'); assert.equal(rows[0].subscription_status, 'active');
    reset(); status = s; failure = 'write'; await assert.rejects(run);
  }
  reset(); failure = 'missing'; changedDuringRead = true; assert.equal((await run()).downgraded, 0); assert.equal(rows[0].stripe_subscription_id, 'replacement');
  console.log('PASS subscription reconciliation guarded replacements, all-location cancellation, exact counts, retries and conservative Stripe failures');
})().catch(e => { console.error(e); process.exitCode = 1; });
