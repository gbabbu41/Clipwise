// A payment that SUCCEEDED but whose ledger row can't be saved is logged to the
// existing error_logs (ids only, no PII/amounts), never silently dropped, and
// never breaks or repeats the payment flow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}

let script, inserts, logs, logThrows;
const db = { from(table) {
  let op = 'read', values;
  const q = { select() { return q; }, eq() { return q; }, limit() { return q; }, maybeSingle() { return q; },
    insert(v) { op = 'insert'; values = v; return q; },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        if (table === 'error_logs') { if (logThrows) throw new Error('log store down'); logs.push(values); return { data: null, error: null }; }
        if (table === 'transactions' && op === 'insert') {
          inserts.push(values);
          const next = script.shift();
          if (next === 'throw') throw new Error('network timeout');
          return next ? { data: null, error: { message: next } } : { data: null, error: null };
        }
        if (table === 'shops') return { data: { stripe_account_id: 'acct', stripe_connected: true }, error: null };
        return { data: [], error: null };   // dedupe read: nothing recorded yet
      }).then(resolve, reject);
    } };
  return q;
} };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { stripeFeeCents: async () => 164 },
  '@/lib/payment-notify': { sendPaymentReceipt: async () => {}, notifyNoShowCharged: async () => {} },
  '@/lib/completion-server': { runServerCompletionEffects: async () => {} },
  '@/lib/emailer': { sendAppEmail: async () => {} },
  '@/lib/pricing': {},
};
const { recordOnlinePaymentTx } = load('src/lib/finalize-appointment-payment.ts', mocks);
const args = { appointmentId: 'appt_1', shopId: 'shop_1', barberId: 'b', clientName: 'Jane Secret', serviceName: 'Skin Fade', amountDollars: 35, taxDollars: 5.25, paymentIntentId: 'pi_1' };
const run = async (steps, opts = {}) => { script = [...steps]; inserts = []; logs = []; logThrows = !!opts.logThrows; await recordOnlinePaymentTx(args); };

(async () => {
  await run([null]);
  assert.equal(inserts.length, 1); assert.equal(logs.length, 0, 'success → no log');

  await run(['column "tax" does not exist', null]);
  assert.equal(inserts.length, 2); assert.equal(logs.length, 0, 'legacy column retry that succeeds → no log');

  await run(['connection reset by peer']);
  assert.equal(inserts.length, 1, 'no blind retry of a non-column failure');
  assert.equal(logs.length, 1, 'failure logged');
  const log = logs[0];
  assert.equal(log.source, 'ledger-save'); assert.equal(log.level, 'error'); assert.equal(log.shop_id, 'shop_1');
  assert(log.message.includes('appt_1') && log.message.includes('pi_1'), 'ids to find + recover it');
  assert(!log.message.includes('Jane') && !log.message.includes('35') && !log.message.includes('Skin Fade'), 'no names/amounts/services');
  assert.deepEqual(Object.keys(log).sort(), ['level', 'message', 'path', 'shop_id', 'source']);

  await run(['throw']);
  assert.equal(logs.length, 1, 'thrown save error logged');

  await run(['column "tax" does not exist', 'column "stripe_fee" does not exist', 'permission denied']);
  assert.equal(inserts.length, 3); assert.equal(logs.length, 1, 'final failure of the retry chain logged once');

  await run(['disk full'], { logThrows: true });   // logging itself failing never breaks the flow
  assert.equal(logs.length, 0);

  // The same visible-failure pattern exists in every other card-payment ledger writer.
  for (const [file, where] of [['src/app/api/stripe/capture-appointment/route.ts', 'capture-appointment'], ['src/app/api/webhooks/stripe/route.ts', 'webhook-balance'], ['src/app/api/appointments/collect-balance/route.ts', 'collect-balance']]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert(src.includes(`logLedgerSaveFailure("${where}"`), `${where} logs a failed ledger save`);
  }
  for (const file of ['src/lib/finalize-appointment-payment.ts', 'src/app/api/stripe/capture-appointment/route.ts', 'src/app/api/appointments/collect-balance/route.ts']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!/from\("transactions"\)[^;]*\.insert\([^;]*\.then\(null, \(\) => null\)/.test(src), `${file}: no silently swallowed ledger insert`);
  }
  console.log('PASS ledger save log: failures logged once with ids only (no PII), legacy column retry kept, no blind retries, logging never breaks the flow, all card ledger writers covered');
})().catch(e => { console.error(e); process.exitCode = 1; });
