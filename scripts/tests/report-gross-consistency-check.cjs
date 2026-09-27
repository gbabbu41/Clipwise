// Cross-screen/report consistency for "Gross collected": every screen or report
// that shows it (Payments, Dashboard, Analytics headline + chart, weekly email)
// uses the ONE rule in src/lib/revenue.ts, loads the ids it needs, and the Tax
// page's tax liability is unchanged by it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(file) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => id.startsWith('./') ? load(`src/lib/${id.slice(2)}.ts`) : req(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// ── 1. Static: every reporting query loads booking ids + transaction appointment_id.
const selectsOf = (src, table) => [...src.matchAll(new RegExp(`from\\("${table}"\\)[\\s\\S]{0,120}?\\.select\\("([^"]+)"`, 'g'))].map(m => m[1]);
const hasCol = (sel, col) => sel.trim().startsWith('*') || sel.split(',').map(c => c.trim()).includes(col);
const reports = {
  'Dashboard': 'src/app/dashboard/page.tsx',
  'Tax page': 'src/app/dashboard/payments/tax/page.tsx',
  'Weekly email': 'src/app/api/cron/reminders/route.ts',
  'Analytics': 'src/app/dashboard/analytics/page.tsx',
};
for (const [name, file] of Object.entries(reports)) {
  const src = read(file);
  const apptSel = selectsOf(src, 'appointments').filter(s => s.includes('total_amount') || s.trim().startsWith('*'));
  const txSel = selectsOf(src, 'transactions').filter(s => s.includes('payment_intent_id') || s.trim().startsWith('*'));
  assert(apptSel.length && txSel.length, `${name}: revenue queries found`);
  for (const s of apptSel) assert(hasCol(s, 'id'), `${name}: booking query must load id → ${s}`);
  for (const s of txSel) assert(hasCol(s, 'appointment_id'), `${name}: transaction query must load appointment_id → ${s}`);
}
const payments = read('src/app/dashboard/payments/page.tsx');
assert(/TX_COLS = "[^"]*\bappointment_id\b/.test(payments) && /savedChargeGross\(txs\)/.test(payments), 'Payments: loads appointment_id and uses the shared rule');
assert(/label">Gross collected \(before card fees\)</.test(read('src/lib/emailer.ts')), 'weekly email labels its metric as gross before card fees');

// ── 2. Behavioral: one dataset → same Gross everywhere; tax unchanged.
const { collectedTotals } = load('src/lib/revenue.ts');
const { analyticsRevenueBuckets, analyticsPeriod } = load('src/lib/analytics-period.ts');
const { confirmedFeesFromRows } = load('src/lib/confirmed-fees.ts');
const now = new Date(); const iso = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString();
const appt = o => ({ client_name: 'C', payment_status: 'captured', payment_method: 'card', status: 'completed', tax_amount: 0, tip_amount: 0, gift_applied: 0, balance_due: null, paid_at: iso, created_at: iso, ...o });
const row = o => ({ client_name: 'C', amount: 0, tax: 0, tip: 0, payment_method: 'card', created_at: iso, refunded: false, source: 'completion', ...o });
const appts = [
  appt({ id: 'aug7', total_amount: 35, tip_amount: 5.25, payment_intent_id: 'pi_svc' }),              // tip on its own charge
  appt({ id: 'sep4', total_amount: 74.75, tax_amount: 9.75, payment_intent_id: 'pi_cap' }),          // raised above capture
  appt({ id: 'split', total_amount: 74.75, tax_amount: 9.75, balance_due: 0, payment_intent_id: 'pi_s' }), // capture + balance
  appt({ id: 'cash', total_amount: 25, payment_method: 'cash', payment_status: 'paid', payment_intent_id: null }),
];
const txs = [
  row({ appointment_id: 'aug7', payment_intent_id: 'pi_svc', amount: 35, fee: 1.6 }),
  row({ appointment_id: 'aug7', payment_intent_id: 'pi_tip', amount: 0, tip: 5.25, fee: 0.49 }),
  row({ appointment_id: 'sep4', payment_intent_id: 'pi_cap', amount: 35, tax: 5.25, fee: 1.79 }),
  row({ appointment_id: 'split', payment_intent_id: 'pi_s', amount: 35, tax: 5.25, fee: 1.79 }),
  row({ appointment_id: 'split', payment_intent_id: 'pi_b', source: 'balance', amount: 30, tax: 4.5, fee: 1.3 }),
  row({ source: 'pos', payment_intent_id: 'pi_pos', amount: 27, tax: 4.05, fee: 1.2 }),
];
const byPi = confirmedFeesFromRows(txs.map((r, i) => ({ id: `r${i}`, stripe_fee: r.fee, ...r })));
const cents = n => Math.round(n * 100) / 100;
const expected = 35 + 5.25 + 40.25 + 40.25 + 34.5 + 25 + 31.05; // what the charges took + cash + POS

const dashboard = collectedTotals(appts, txs, byPi);                      // Dashboard / Analytics headline
const weekly = collectedTotals(appts, txs);                                // weekly email (no fee data)
const chart = analyticsRevenueBuckets(appts, txs, analyticsPeriod('year', now), byPi).daily.reduce((s, d) => s + d.revenue, 0);
const chartNoFees = analyticsRevenueBuckets(appts, txs, analyticsPeriod('year', now)).daily.reduce((s, d) => s + d.revenue, 0);
assert.equal(cents(dashboard.gross), cents(expected), 'Dashboard/Analytics gross');
assert.equal(cents(weekly.gross), cents(expected), 'weekly email gross = same metric');
assert.equal(cents(chart), cents(expected), 'Analytics chart sums to the headline');
assert.equal(cents(chartNoFees), cents(expected), 'chart independent of fee data');
assert.equal(cents(dashboard.gross - dashboard.fees), cents(dashboard.net), 'gross − fees = net');

// Same data without booking ids / appointment links → same Gross (no silent rule switch)
// except what ids exist to prevent: a separately-paid tip counted twice.
const noIds = collectedTotals(appts.map(({ id, ...a }) => a), txs.map(({ appointment_id, ...t }) => t), byPi);
assert.equal(cents(noIds.gross), cents(expected), 'no ids → same gross rule');

// Tax page: tax liability unchanged (booking tax as before — not scaled to the capture).
assert.equal(cents(collectedTotals(appts, txs).tax), cents(0 + 9.75 + 9.75 + 0 + 4.05), 'tax liability unchanged');

console.log('PASS report gross consistency: Dashboard, Analytics headline + chart, weekly email and Payments share one rule, queries load ids, tax unchanged');
