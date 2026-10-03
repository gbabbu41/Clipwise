const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
const load = rel => { const f = path.join(root, rel), m = new Module(f, module); m.filename = f; m.require = id => id.startsWith('./') ? load(path.join(path.dirname(rel), id.slice(2)) + '.ts') : id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : req(id); m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f); return m.exports; };
const { collectedTotals } = load('src/lib/revenue.ts');
const { analyticsRevenueBuckets, analyticsPeriod } = load('src/lib/analytics-period.ts');
const c = n => Math.round(n * 100) / 100;

// Owner rule (2026-10-02): revenue is a statement, not a rewrite. A $45.50 card sale
// (35 + 5.25 tax + 5.25 tip, Stripe fee 1.62) paid MONDAY, fully refunded WEDNESDAY.
const MON = new Date(2026, 8, 14, 11).toISOString(), WED = new Date(2026, 8, 16, 15).toISOString();
const appt = { id: 'a1', client_name: 'C', total_amount: 40.25, tax_amount: 5.25, tip_amount: 5.25, payment_status: 'refunded', payment_method: 'card', payment_intent_id: 'pi_1', status: 'completed', barber_id: 'gill', paid_at: MON, created_at: MON };
const sale = { id: 't1', client_name: 'C', amount: 35, tax: 5.25, tip: 5.25, payment_method: 'card', payment_intent_id: 'pi_1', source: 'completion', appointment_id: 'a1', refunded: true, created_at: MON, barber_id: 'gill' };
const refund = { id: 'r1', client_name: 'C', amount: -35, tax: -5.25, tip: -5.25, payment_method: 'card', payment_intent_id: 'pi_1', source: 'refund', appointment_id: 'a1', refunded: true, created_at: WED, barber_id: 'gill' };
const byPi = { pi_1: { gross: 45.5, fee: 1.62, net: 43.88 } };

// Monday alone: the sale, exactly as it read before the refund — the past doesn't change.
const mon = collectedTotals([appt], [sale], byPi);
assert.deepEqual([c(mon.gross), c(mon.net), c(mon.fees), c(mon.tax), c(mon.tips), c(mon.refunds)], [45.5, 43.88, 1.62, 5.25, 5.25, 0]);
// Wednesday alone: money out on the day it went back (no fee returned — Stripe keeps it).
const wed = collectedTotals([], [refund], byPi);
assert.deepEqual([c(wed.gross), c(wed.net), c(wed.fees), c(wed.tax), c(wed.tips), c(wed.refunds)], [-45.5, -45.5, 0, -5.25, -5.25, 45.5]);
// The whole week: they cancel out; only the fee Stripe kept remains as a cost.
const week = collectedTotals([appt], [sale, refund], byPi);
assert.deepEqual([c(week.gross), c(week.net), c(week.fees), c(week.tax), c(week.tips)], [0, -1.62, 1.62, 0, 0]);
assert.equal(c(week.gross - week.fees), c(week.net), 'gross − fees = net');
// Net revenue offsets too: tips paid out on Monday come back on Wednesday (not clamped).
const netRev = t => t.net - t.tax - (t.tips - t.ownerTips);
assert.equal(c(netRev(mon) + netRev(wed)), c(netRev(week)));
assert.equal(c(netRev(week)), -1.62);

// The chart puts each on its own day, and the bars sum to the headline.
const range = analyticsPeriod('week', new Date(2026, 8, 16, 12));
const b = analyticsRevenueBuckets([appt], [sale, refund], range, byPi);
const day = d => b.daily.find(r => r.date === `2026-09-${d}`).revenue;
assert.equal(c(day(14)), 45.5); assert.equal(c(day(16)), -45.5);
assert.equal(c(b.daily.reduce((s, r) => s + r.revenue, 0)), c(week.gross));

// A POS sale refunded later behaves the same way.
const pos = { id: 'p1', client_name: 'W', amount: 20, tax: 3, tip: 0, payment_method: 'card', payment_intent_id: 'pi_p', source: 'pos', refunded: true, created_at: MON };
const posRefund = { ...pos, id: 'pr', amount: -20, tax: -3, source: 'refund', created_at: WED };
assert.equal(c(collectedTotals([], [pos]).gross), 23);
assert.equal(c(collectedTotals([], [posRefund]).gross), -23);
assert.equal(c(collectedTotals([], [pos, posRefund]).gross), 0);

// Every report loads refunded sales (so they keep counting on their paid day).
const src = f => fs.readFileSync(path.join(root, f), 'utf8');
assert.match(src('src/app/dashboard/page.tsx'), /\.in\("payment_status", \["paid", "captured", "refunded"\]\)/);
assert.match(src('src/app/dashboard/analytics/page.tsx'), /\.in\("payment_status", \["paid", "captured", "refunded"\]\)/);
assert.doesNotMatch(src('src/app/dashboard/analytics/page.tsx'), /transactions\.filter\(t =>\s*!t\.refunded/, 'analytics keeps refund rows in the money set');
assert.doesNotMatch(src('src/app/dashboard/page.tsx') + src('src/app/dashboard/analytics/page.tsx'), /Math\.max\(0, (collected|t)\.tips - (collected|t)\.ownerTips\)/, 'tips not clamped');
// Legacy refunds got their refund row dated at the sale (phase74), with the app's id.
const sql = src('supabase/migrations/phase74_refund_rows_for_legacy_refunds.sql');
assert.match(sql, /'clipwise-refund-ledger:' \|\| t\.payment_intent_id/);
assert.match(sql, /on conflict \(id\) do nothing/);
// "Collected" = money that CAME IN (never pulled below zero by a refund); refunds
// and the net after refunds are their own lines — Dashboard, Payments, Analytics.
const carousel = src('src/components/dashboard/stats-carousel.tsx');
assert.match(carousel, /const collectedIn = revenue \+ refunds;/);
assert.match(carousel, /\{formatCurrency\(collectedIn\)\}\s*<\/p>/, 'headline = money in');
assert.match(carousel, /Refunded <span[^>]*>−\{formatCurrency\(refunds\)\}/);
assert.match(carousel, /Net after refunds/);
assert.match(carousel, /revenue \+ feesPaid > 0 \|\| refunds > 0 \|\| feesPaid > 0/, 'breakdown still shows on a ≤ 0 day');
assert.match(src('src/app/dashboard/page.tsx'), /refunds=\{collected\.refunds\} refundCount=\{txnsInRange\.filter\(isRefundRow\)\.length\}/);
const pay = src('src/app/dashboard/payments/page.tsx');
assert.match(pay, /headline: s\.net \+ s\.cash \+ s\.refunds/, 'Payments headline = money in');
assert.match(pay, /net: s\.net \+ s\.cash \}/);
assert.match(pay, /− Refunds<\/span>[\s\S]{0,200}Net after refunds/);
const an = src('src/app/dashboard/analytics/page.tsx');
assert.match(an, /sales: t\.gross \+ t\.refunds, fees: t\.fees, collected: t\.net \+ t\.refunds, refunds: t\.refunds, netAfterRefunds: t\.net/);
assert.match(an, /const totalRevenue = money\.sales;/);
// The numbers: Oct 2 smoke test — $40.25 sale (fee 1.79), refunds 40.25 + 15.93.
const oct2 = collectedTotals([], [
  { client_name: 'C', amount: 35, tax: 5.25, tip: 0, payment_method: 'card', payment_intent_id: 'pi_a', source: 'pos', refunded: true, created_at: WED },
  { client_name: 'C', amount: -35, tax: -5.25, tip: 0, payment_method: 'card', payment_intent_id: 'pi_a', source: 'refund', refunded: true, created_at: WED },
  { client_name: 'C', amount: -13.85, tax: -2.08, tip: 0, payment_method: 'card', payment_intent_id: 'pi_b', source: 'refund', refunded: true, created_at: WED },
], { pi_a: { gross: 40.25, fee: 1.79, net: 38.46 } });
assert.equal(c(oct2.net + oct2.refunds), 38.46, 'Collected (money in)');
assert.equal(c(oct2.refunds), 56.18, 'Refunded');
assert.equal(c(oct2.net), -17.72, 'Net after refunds');
console.log('PASS refund statement: sale stays on its paid day, refund is money out on its own day (fee kept), week nets to −fee, chart + POS + every report agree');
