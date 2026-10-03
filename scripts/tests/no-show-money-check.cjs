// No-shows (owner decision 2026-10-03): the shop keeps the money and it is split
// with the barber like any payment; only a refund takes it back. A booking PAID IN
// ADVANCE that no-shows must stay in Collected (it used to drop to $0); a no-show
// FEE captured from a held card counts once (its own line).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
const load = rel => { const f = path.join(root, rel), m = new Module(f, module); m.filename = f; m.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : id.startsWith('./') ? load(path.relative(root, path.join(path.dirname(f), `${id}.ts`))) : req(id); m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f); return m.exports; };
const rev = load('src/lib/revenue.ts'), be = load('src/lib/barber-earnings.ts'), ap = load('src/lib/analytics-period.ts'), plan = load('src/lib/refund-plan.ts');
const c = n => Math.round(n * 100);

// A $40.25 booking paid online in advance (its earnings line = the completion row).
const prepaid = { id: 'a', client_name: 'J', total_amount: 40.25, tax_amount: 5.25, tip_amount: 0, payment_status: 'paid', payment_method: 'card', payment_intent_id: 'pi_1', status: 'confirmed', paid_at: '2026-10-05T15:00:00Z', created_at: '2026-10-01T10:00:00Z' };
const line = { client_name: 'J', amount: 35, tax: 5.25, tip: 0, payment_method: 'card', source: 'completion', payment_intent_id: 'pi_1', appointment_id: 'a', barber_id: 'gill', service_name: 'Skin Fade', created_at: '2026-10-05T15:00:00Z' };
const noShow = { ...prepaid, status: 'no-show' };

// 1. The shop keeps a prepaid no-show's money.
assert.equal(c(rev.collectedTotals([prepaid], [line]).gross), 4025);
assert.equal(c(rev.collectedTotals([noShow], [line]).gross), 4025, 'prepaid no-show stays collected (was $0)');
assert.equal(c(rev.collectedTotals([noShow], [line]).tax), 525);
assert.equal(rev.countablePosTxs([noShow], [line]).length, 0, 'its earnings line is never a second sale');
// Gift-card prepaid no-show: no new money (counted at sale), tax still the sale's.
const giftNs = { ...noShow, payment_method: 'gift_card', payment_intent_id: null, gift_applied: 40.25 };
assert.deepEqual([c(rev.collectedTotals([giftNs], []).gross), c(rev.collectedTotals([giftNs], []).tax)], [0, 525]);

// 2. A no-show FEE from a held card counts ONCE (its fee line), never the booking total.
const feeAppt = { ...prepaid, id: 'f', payment_status: 'captured', status: 'no-show', payment_intent_id: 'pi_f' };
const feeRow = { client_name: 'J', amount: 17.5, tax: 0, tip: 0, payment_method: 'card', source: 'no_show', payment_intent_id: 'pi_f', appointment_id: 'f', service_name: 'No-show fee — Skin Fade', created_at: '2026-10-05T15:00:00Z' };
assert.equal(c(rev.collectedTotals([feeAppt], [feeRow]).gross), 1750);
// Refunded fee no-show (no booking payment line) stays skipped; refunded PREPAID no-show = sale − refund.
assert.equal(rev.noShowFeeVisit({ status: 'no-show', payment_status: 'refunded', payment_intent_id: 'pi_f' }, rev.paidAheadPis([feeRow])), true);
assert.equal(rev.noShowFeeVisit({ status: 'no-show', payment_status: 'refunded', payment_intent_id: 'pi_1' }, rev.paidAheadPis([line])), false);
assert.equal(rev.noShowFeeVisit({ status: 'no-show', payment_status: 'paid' }), false);
assert.equal(rev.noShowFeeVisit({ status: 'no-show', payment_status: 'captured' }), true);
assert.equal(rev.noShowFeeVisit({ status: 'completed', payment_status: 'captured' }), false);
const refundRow = { client_name: 'J', amount: -35, tax: -5.25, tip: 0, payment_method: 'card', source: 'refund', payment_intent_id: 'pi_1', appointment_id: 'a', barber_id: 'gill', service_name: 'Refund — Skin Fade', created_at: '2026-10-07T15:00:00Z' };
assert.equal(c(rev.collectedTotals([{ ...noShow, payment_status: 'refunded' }], [line, refundRow]).gross), 0, 'refunded prepaid no-show nets to 0');

// 3. The chart and the fees check agree with the headline.
const range = ap.analyticsPeriod('month', new Date('2026-10-20T12:00:00'));
const bars = ap.analyticsRevenueBuckets([noShow], [line], range).daily.reduce((s, d) => s + d.revenue, 0);
assert.equal(c(bars), 4025, 'chart counts the prepaid no-show too');
assert.equal(ap.analyticsFeesKnown([noShow], [line], { pi_1: { gross: 40.25, fee: 1.47, net: 38.78 } }), true);

// 4. Split everything (owner decision 2026-10-03): any money a no-show paid is
//    split at the barber's % — the prepaid visit's line AND a no-show fee — and
//    only a refund takes it back.
assert.equal(be.computeBarberEarnings([line], 50).youKeep, 17.5, 'prepaid no-show: barber keeps 50%');
assert.equal(c(be.computeBarberEarnings([feeRow], 50).youKeep), 875, 'no-show fee: barber gets 50% of $17.50');
assert.equal(c(be.refundClawback(refundRow, 50)), 1750, 'a refund takes the cut back');
assert.equal(c(be.computeBarberEarnings([line, refundRow], 50).youKeep), 0);
assert.equal(rev.refundServiceKey('Refund — Skin Fade (back on gift card)'), 'Skin Fade');

// 5. Refunding a prepaid no-show refunds its own payment (not labelled a fee).
const part = plan.planAppointmentRefund(noShow, [line])[0];
assert.deepEqual([part.label, part.cents], ['Card', 4025]);
const feePart = plan.planAppointmentRefund(feeAppt, [feeRow])[0];
assert.deepEqual([feePart.label, feePart.cents], ['No-show fee · Card', 1750]);

// 6. Every shop screen counts that commission the same way.
const src = f => fs.readFileSync(path.join(root, f), 'utf8');
for (const f of ['src/app/dashboard/page.tsx', 'src/app/dashboard/analytics/page.tsx', 'src/app/dashboard/payroll/page.tsx']) {
  const s = src(f);
  assert.match(s, /noShowFeeVisit\(a, paidAhead\)/, `${f}: prepaid no-shows pay commission`);
  assert.doesNotMatch(s, /isNoShowEarning/, `${f}: no no-show exclusion left`);
  assert.doesNotMatch(s, /status === "no-show" \|\| !a\.barber_id|status !== "no-show"\);/, `${f}: commission not cut on no-shows`);
}
assert.doesNotMatch(src('src/lib/barber-earnings.ts'), /isNoShowEarning|isBarberLedgerRow/, 'one rule: no special no-show case in barber pay');
assert.match(src('src/app/dashboard/payments/page.tsx'), /\.filter\(a => !noShowFeeVisit\(a, paidAhead\)\)/);
console.log('PASS no-show money: prepaid no-show stays collected (was $0; chart + fees agree), no-show fee counts once, refunded fee / prepaid handled, gift prepaid adds no new money, barber splits prepaid no-shows and no-show fees, a refund takes it back, every shop screen agrees');
