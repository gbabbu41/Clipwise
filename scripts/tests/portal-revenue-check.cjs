const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const ts = require('typescript');
function load(file) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : require(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return m.exports;
}
const { collectedTotals, transactionCollectedAmount } = load('src/lib/revenue.ts');
const { computeBarberEarnings } = load('src/lib/barber-earnings.ts');
const { bookingChartDays } = load('src/lib/booking-chart.ts');
const base = { client_name: 'Synthetic fixture', amount: 100, tax: 15, tip: 0, source: 'pos', payment_method: 'cash', created_at: '2026-09-17T12:00:00Z', barber_id: 'staff', commission_amount: 50 };
let result = collectedTotals([], [base]);
assert.equal(result.gross, 115); assert.equal(result.cash, 115); assert.equal(result.net, 115); assert.equal(result.preTax, 100);
assert.equal(result.net - result.tax - 50, 50);
assert.equal(collectedTotals([], [{ ...base, amount: 100, tax: 0 }]).cash, 100);
// $100 total inclusive of the fixture's 15% tax is NOT $100 + $15.
assert.equal(transactionCollectedAmount({ amount: 86.96, tax: 13.04, tip: 0 }), 100);
result = collectedTotals([], [{ ...base, payment_method: 'card', payment_intent_id: 'pi_fixture', tip: 20 }], { pi_fixture: { gross: 135, fee: 4, net: 131 } });
assert.equal(result.gross, 135); assert.equal(result.net, 131); assert.equal(result.fees, 4); assert.equal(result.cash, 0);
assert.equal(result.gross - result.fees, result.net);
assert.equal(collectedTotals([], [{ ...base, refunded: true }]).gross, 0);
assert.equal(collectedTotals([], [{ ...base, source: 'refund', amount: -100 }]).gross, 0);
const appt = { client_name: base.client_name, total_amount: 115, tax_amount: 15, payment_status: 'paid', payment_method: 'cash', status: 'completed' };
assert.equal(collectedTotals([appt], [{ ...base, source: 'completion' }]).gross, 115);
result = collectedTotals([], [{ ...base, tip: 20, barber_id: 'owner' }], undefined, 'owner');
assert.equal(result.ownerTips, 20); assert.equal(result.tips, 20); assert.equal(result.net - result.tax - (result.tips - result.ownerTips), 120);
assert.equal(computeBarberEarnings([{ ...base, tip: 20, stripe_fee: 4 }], 50).youKeep, 70);
assert.equal(computeBarberEarnings([{ ...base, tip: 20, stripe_fee: 4, commission_amount: 0 }], 0, true).youKeep, 120);
const days = bookingChartDays([{ date: '2026-09-01' }, { date: '2026-09-17' }], '2026-09-01', '2026-09-17');
assert.equal(days.length, 14); assert.equal(days[0].date, '2026-09-04'); assert.equal(days[0].count, 0); assert.equal(days[13].count, 1);
assert.equal(bookingChartDays([], '2026-09-17', '2026-09-17').length, 1);
assert.deepEqual(bookingChartDays([], '2026-09-18', '2026-09-17'), []);
const leap = bookingChartDays([], '2024-02-28', '2024-03-01');
assert.equal(leap.length, 3); assert.equal(leap[1].date, '2024-02-29');
const paymentSource = fs.readFileSync(path.join(root, 'src/app/dashboard/payments/page.tsx'), 'utf8');
assert(paymentSource.includes('amount: transactionCollectedAmount(t)'));
console.log('PASS portal revenue: cash/card/tax-inclusive/no-tax/tips/refunds/dedup/owner commission + calendar zero buckets');
const { readAllRows } = load('src/lib/read-all-rows.ts');
(async () => {
  // Server may enforce a lower cap than the requested range. Continue to empty.
  const fixtures = Array.from({ length: 1001 }, (_, id) => ({ id }));
  const read = await readAllRows(async (from, to) => ({ data: fixtures.slice(from, Math.min(to + 1, from + 100)), error: null }));
  assert.equal(read.length, 1001); assert.equal(read[1000].id, 1000);
  await assert.rejects(readAllRows(async () => ({ data: null, error: { message: 'failed' } })));
  await assert.rejects(readAllRows(async from => from ? { data: null, error: {} } : { data: fixtures.slice(0, 100), error: null }));
  assert.deepEqual(await readAllRows(async () => ({ data: [], error: null })), []);
  console.log('PASS complete ledger pagination: small server cap, multiple pages, empty report and failed later page');
})().catch(error => { console.error(error); process.exitCode = 1; });
