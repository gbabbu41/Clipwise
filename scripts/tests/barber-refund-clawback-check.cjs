const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
const load = rel => { const f = path.join(root, rel), m = new Module(f, module); m.filename = f; m.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : req(id); m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f); return m.exports; };
const { computeBarberEarnings, barberRowCut, refundClawback } = load('src/lib/barber-earnings.ts');
const { apptSpend } = load('src/lib/client-identity.ts');
const c = n => Math.round(n * 100) / 100;

// Owner decision (2026-10-03): a refund takes the barber's cut back ON THE REFUND
// DAY. Gill (50%) cuts a $35 Skin Fade + $5 tip on Monday; it's refunded Wednesday.
const sale = { amount: 35, tip: 5, commission_amount: null, refunded: true, source: 'completion', service_name: 'Skin Fade' };
const refund = { amount: -35, tip: -5, commission_amount: null, refunded: true, source: 'refund', service_name: 'Refund — Skin Fade' };
// Monday's pay period — already paid out — never changes: $17.50 + $5 tip.
let e = computeBarberEarnings([sale], 50);
assert.deepEqual([c(e.commission), c(e.tips), c(e.youKeep), e.count], [17.5, 5, 22.5, 1]);
// Wednesday's period shows the take-back as a deduction (not silently lost).
e = computeBarberEarnings([refund], 50);
assert.deepEqual([c(e.commission), c(e.tips), c(e.youKeep), e.count], [-17.5, -5, -22.5, 0]);
// Across both: zero — the barber is never paid for a refunded visit.
e = computeBarberEarnings([sale, refund], 50);
assert.equal(c(e.youKeep), 0);
assert.equal(c(barberRowCut(refund, 50)), -22.5, 'statement row: −cut −tip');
// Owner's own chair keeps (and gives back) 100%.
assert.equal(c(computeBarberEarnings([sale, refund], 0, true).youKeep), 0);
assert.equal(c(barberRowCut(refund, 0, true)), -40);
// A POS sale's STORED cut is what comes back (refund row carries it negated).
assert.equal(refundClawback({ amount: -40, commission_amount: -12, source: 'refund' }, 50), 12);
assert.equal(refundClawback({ amount: -40, commission_amount: null, source: 'refund' }, 50), 20, 'else the rate');
// No-show money is split like any payment (owner decision 2026-10-03): a no-show
// fee pays the barber their %, and its refund takes that back.
const nsFee = { amount: 19.25, tip: 0, source: 'no_show', service_name: 'No-show fee — Skin Fade' };
const nsRefund = { amount: -19.25, tip: 0, source: 'refund', service_name: 'Refund — No-show fee — Skin Fade' };
assert.equal(c(computeBarberEarnings([nsFee], 50).youKeep), 9.63, 'barber gets 50% of the fee');
assert.equal(c(refundClawback(nsRefund, 50)), 9.63, 'its refund takes that back');
assert.equal(c(computeBarberEarnings([nsFee, nsRefund], 50).youKeep), 0);
// A sale is never mistaken for a refund.
assert.equal(refundClawback(sale, 50), 0);
// Split refund: since phase76 a gift-paid visit HAS its earnings line in the
// barber's own ledger, so its gift-card refund part takes that cut back there too
// (like the card part). Shop-wide commission takes every part back as well.
const giftPart = { amount: -20, tip: 0, source: 'refund', payment_method: 'gift_card', service_name: 'Refund — Skin Fade (back on gift card)' };
const cardPart = { amount: -15, tip: -5, source: 'refund', payment_method: 'card', service_name: 'Refund — Skin Fade (balance · card)' };
assert.equal(c(computeBarberEarnings([giftPart, cardPart], 50).youKeep), -22.5, 'portal: both parts come back (gift $10 cut + card $7.50 cut + $5 tip)');
assert.equal(refundClawback(giftPart, 50), 10, 'shop-wide: the gift part comes back too');

// Every screen uses the same take-back.
const src = f => fs.readFileSync(path.join(root, f), 'utf8');
const api = src('src/app/api/barber/earnings/route.ts');
assert.match(api, /const list = transactions \?\? \[\];/, 'barber API keeps every row (refunds, no-show money)');
assert.doesNotMatch(api, /!t\.refunded/);
assert.match(src('src/app/barber-dashboard/earnings/page.tsx'), /barberRowCut\(t, pct, isOwner\)/);
assert.match(src('src/app/dashboard/payments/page.tsx'), /\? txs\.filter\(t => t\.barber_id === selectedBarber\)/);
for (const f of ['src/app/dashboard/page.tsx', 'src/app/dashboard/analytics/page.tsx', 'src/app/dashboard/payroll/page.tsx']) {
  const s = src(f);
  assert.match(s, /refundClawback\(/, `${f}: commission taken back on the refund day`);
  assert.doesNotMatch(s, /if \((t|t2)\.refunded \|\| !(t|t2)\.barber_id/, `${f}: refunded POS sales keep their cut on their day`);
}
assert.match(src('src/app/dashboard/payroll/page.tsx'), /\["paid", "captured", "refunded"\]/);
assert.match(src('src/lib/refund-ledger.ts'), /commission_amount: -saleCut/, 'refund row carries the sale\'s stored cut');

// Client lifetime spend = money kept: a refunded or unpaid visit adds $0.
assert.equal(apptSpend({ total_amount: 40.25, payment_status: 'paid' }), 40.25);
assert.equal(apptSpend({ total_amount: 40.25, payment_status: 'refunded' }), 0);
assert.equal(apptSpend({ total_amount: 40.25, payment_status: 'unpaid' }), 0);
assert.equal(apptSpend({ total_amount: 40.25 }), 40.25, 'legacy rows without a status still count');
assert.match(src('src/app/barber-dashboard/clients/page.tsx'), /const spent = done \? apptSpend\(a\) : 0;/);
console.log('PASS barber refund take-back: sale keeps its cut on its day, refund takes cut + tip back on its day (stored POS cut, owner 100%, no-show money split + taken back), every screen agrees, client spend nets refunds');
