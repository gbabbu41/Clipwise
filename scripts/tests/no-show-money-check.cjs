// No-shows (owner decision 2026-10-03): the shop keeps the money, the barber earns
// nothing. A booking PAID IN ADVANCE that no-shows must stay in Collected (it used
// to drop to $0); a no-show FEE captured from a held card counts once (its own
// line); nothing on a no-show is credited to — or taken back from — a barber.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
const load = rel => { const f = path.join(root, rel), m = new Module(f, module); m.filename = f; m.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : id.startsWith('./') ? load(path.relative(root, path.join(path.dirname(f), `${id}.ts`))) : req(id); m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f); return m.exports; };
const rev = load('src/lib/revenue.ts'), be = load('src/lib/barber-earnings.ts'), ap = load('src/lib/analytics-period.ts'), plan = load('src/lib/refund-plan.ts');
const c = n => Math.round(n * 100);

// A $40.25 booking paid online in advance (its earnings line = the completion row).
const prepaid = { id: 'a', client_name: 'J', total_amount: 40.25, tax_amount: 5.25, tip_amount: 0, payment_status: 'paid', payment_method: 'card', payment_intent_id: 'pi_1', status: 'confirmed', paid_at: '2026-10-05T15:00:00Z', created_at: '2026-10-01T10:00:00Z' };
const line = { client_name: 'J', amount: 35, tax: 5.25, tip: 0, payment_method: 'card', source: 'completion', payment_intent_id: 'pi_1', appointment_id: 'a', barber_id: 'gill', service_name: 'Skin Fade', created_at: '2026-10-05T15:00:00Z' };
const noShow = { ...prepaid, status: 'no-show' };
const taggedLine = { ...line, service_name: 'Skin Fade (no-show)' };

// 1. The shop keeps a prepaid no-show's money.
assert.equal(c(rev.collectedTotals([prepaid], [line]).gross), 4025);
assert.equal(c(rev.collectedTotals([noShow], [taggedLine]).gross), 4025, 'prepaid no-show stays collected (was $0)');
assert.equal(c(rev.collectedTotals([noShow], [taggedLine]).tax), 525);
assert.equal(rev.countablePosTxs([noShow], [taggedLine]).length, 0, 'its earnings line is never a second sale');
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
const refundRow = { client_name: 'J', amount: -35, tax: -5.25, tip: 0, payment_method: 'card', source: 'refund', payment_intent_id: 'pi_1', appointment_id: 'a', barber_id: 'gill', service_name: 'Refund — Skin Fade (no-show)', created_at: '2026-10-07T15:00:00Z' };
assert.equal(c(rev.collectedTotals([{ ...noShow, payment_status: 'refunded' }], [taggedLine, refundRow]).gross), 0, 'refunded prepaid no-show nets to 0');

// 3. The chart and the fees check agree with the headline.
const range = ap.analyticsPeriod('month', new Date('2026-10-20T12:00:00'));
const bars = ap.analyticsRevenueBuckets([noShow], [taggedLine], range).daily.reduce((s, d) => s + d.revenue, 0);
assert.equal(c(bars), 4025, 'chart counts the prepaid no-show too');
assert.equal(ap.analyticsFeesKnown([noShow], [taggedLine], { pi_1: { gross: 40.25, fee: 1.47, net: 38.78 } }), true);

// 4. The barber earns nothing on a no-show, and nothing comes back on its refund.
for (const t of [taggedLine, refundRow, feeRow]) assert.equal(be.isBarberLedgerRow(t), false, t.service_name);
assert.equal(be.isBarberLedgerRow(line), true, 'a normal visit counts');
assert.equal(be.refundClawback(refundRow, 50), 0, 'no commission taken back (none paid)');
assert.equal(be.computeBarberEarnings([taggedLine, refundRow].filter(be.isBarberLedgerRow), 50).youKeep, 0);
assert.equal(rev.refundServiceKey('Refund — Skin Fade (no-show)'), 'Skin Fade');
assert.equal(rev.refundServiceKey('Refund — Skin Fade (back on gift card) (no-show)'), 'Skin Fade');

// 5. Refunding a prepaid no-show refunds its own payment (not labelled a fee), tagged "(no-show)".
const part = plan.planAppointmentRefund(noShow, [taggedLine])[0];
assert.deepEqual([part.label, part.cents], ['Card', 4025]);
const feePart = plan.planAppointmentRefund(feeAppt, [feeRow])[0];
assert.deepEqual([feePart.label, feePart.cents], ['No-show fee · Card', 1750]);
const src = f => fs.readFileSync(path.join(root, f), 'utf8');
assert.match(src('src/app/api/stripe/refund-payment/route.ts'), /const noShowTag = appt\.status === "no-show" \? " \(no-show\)" : ""/);
assert.match(src('src/lib/refund-import.ts'), /appointment\?\.status === "no-show"[^\n]*\(no-show\)/);
assert.match(src('src/app/api/stripe/refund/route.ts'), /appt\.status === "no-show" \? `[^`]*\(no-show\)`/);
assert.match(src('src/app/dashboard/payments/page.tsx'), /\.filter\(a => !noShowFeeVisit\(a, paidAhead\)\)/);
console.log('PASS no-show money: prepaid no-show stays collected (was $0; chart + fees agree), no-show fee counts once, refunded fee / prepaid handled, gift prepaid adds no new money, barber earns nothing and nothing is taken back, refunds tagged "(no-show)"');
