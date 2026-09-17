const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript');
let rows, readFailure, writeFailure, notifications, emails, beforeWrite;
const now = Date.parse('2026-09-17T12:00:00Z');
function reset() {
  rows = [{ id: 'shop', owner_id: 'owner', name: 'QA', email: 'qa@example.invalid', trial_ends_at: '2026-09-16T12:00:00Z', subscription_plan: 'premium', subscription_status: 'active', stripe_subscription_id: null }];
  readFailure = writeFailure = false; notifications = []; emails = []; beforeWrite = null;
}
const db = { from() {
  let filters = [], values;
  const q = { select() { return q; }, not(k, op, v) { filters.push(r => r[k] !== v); return q; },
    is(k, v) { filters.push(r => r[k] === v); return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
    update(v) { values = v; return q; }, then(resolve, reject) { return Promise.resolve().then(() => {
      if (values && beforeWrite) { const f = beforeWrite; beforeWrite = null; f(); }
      if (values ? writeFailure : readFailure) return { data: null, error: {} };
      const found = rows.filter(r => filters.every(f => f(r)));
      if (values) found.forEach(r => Object.assign(r, values));
      return { data: found.map(r => ({ ...r })), error: null };
    }).then(resolve, reject); } };
  return q;
} };
const mocks = { '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/notify-server': { insertNotifications: async v => notifications.push(v) }, '@/lib/emailer': { sendAppEmail: async (...v) => emails.push(v) } };
const filename = path.join(root, 'src/lib/process-trials.ts'), m = new Module(filename, module); m.filename = filename; m.require = id => mocks[id] ?? appReq(id);
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const run = () => m.exports.processTrials(now);
(async () => {
  reset(); readFailure = true; await assert.rejects(run); assert.equal(emails.length, 0);
  reset(); writeFailure = true; await assert.rejects(run); assert.equal(notifications.length, 0); assert.equal(emails.length, 0);
  for (const mutation of [{ stripe_subscription_id: 'new_paid' }, { trial_ends_at: '2026-10-01T12:00:00Z' }, { subscription_status: 'inactive' }]) {
    reset(); beforeWrite = () => Object.assign(rows[0], mutation); assert.equal((await run()).expired, 0); assert.equal(emails.length, 0); assert.equal(notifications.length, 0);
  }
  reset(); assert.equal((await run()).expired, 1); assert.equal(rows[0].subscription_status, 'inactive'); assert.equal(rows[0].trial_ended_at, '2026-09-16T12:00:00Z'); assert.equal(emails[0][0], 'trial_ended');
  assert.equal((await run()).expired, 0); assert.equal(emails.length, 1);
  reset(); rows[0].trial_ends_at = '2026-09-20T12:00:00Z'; assert.equal((await run()).reminded, 1); assert.equal(emails[0][0], 'trial_reminder'); assert.equal(rows[0].subscription_status, 'active');
  // Exercise the actual cron orchestration functions without sending reminders.
  const cronPath = path.join(root, 'src/app/api/cron/reminders/route.ts');
  const source = ts.createSourceFile(cronPath, fs.readFileSync(cronPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && ['POST', 'GET', 'runSubscriptionMaintenance'].includes(n.name?.text)).map(n => n.getText(source)).join('\n');
  const cron = new Module(cronPath, module); cron.filename = cronPath; cron.require = appReq;
  cron._compile(ts.transpileModule(`import { NextResponse } from 'next/server';
    let permitted=true, fail=false, runs=0, reconciled=0;
    const authorized=()=>permitted;
    const processTrials=async()=>{if(fail)throw Error('Unavailable')};
    const reconcileSubscriptions=async()=>{reconciled++};
    const backfillMissingStripeFees=async()=>{};
    const backfillTerminalLocations=async()=>{};
    const run=async()=>{runs++;return NextResponse.json({ok:true})};
    export const controls={set:(p,f)=>{permitted=p;fail=f},get:()=>({runs,reconciled})};
    ${functions}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, cronPath);
  for (const method of ['GET', 'POST']) {
    cron.exports.controls.set(false, false); const before = cron.exports.controls.get();
    assert.equal((await cron.exports[method]({})).status, 401); assert.deepEqual(cron.exports.controls.get(), before);
    cron.exports.controls.set(true, false); assert.equal((await cron.exports[method]({})).status, 200);
    cron.exports.controls.set(true, true); assert.equal((await cron.exports[method]({})).status, 503);
  }
  assert.deepEqual(cron.exports.controls.get(), { runs: 4, reconciled: 4 });
  console.log('PASS automatic trial expiry confirmed writes, failure visibility, paid/extended/cancelled concurrency guards and repeat-run expiry');
})().catch(e => { console.error(e); process.exitCode = 1; });
