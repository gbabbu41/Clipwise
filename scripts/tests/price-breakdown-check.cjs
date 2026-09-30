// Smoke test (2026-09-30, live): a Skin Fade ($35) paid with 423 loyalty points
// came to $15.93, but nothing — calendar, Payments, alert, transaction, email —
// said points were used or how much. phase72 stores price_breakdown on the
// booking / sale and every surface shows it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const filename = path.join(root, 'src/lib/price-breakdown.ts');
const m = new Module(filename, module); m.filename = filename; m.require = req;
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { buildPriceBreakdown, readPriceBreakdown, discountLines, discountSummary, discountEmailField } = m.exports;

// The real booking: $35, 423 pts = $21.15 (rate $5 / 100 pts).
const pb = buildPriceBreakdown({ subtotal: 35, loyaltyPoints: 423, loyaltyDiscount: 21.15 });
assert.deepEqual(pb, { subtotal: 35, loyalty_discount: 21.15, loyalty_points: 423 });
assert.deepEqual(discountLines(pb), [{ label: 'Loyalty points (423 pts)', amount: -21.15 }]);
assert.equal(discountSummary(pb), '423 pts −$21.15');
assert.equal(discountEmailField(pb), 'Loyalty points (423 pts)::−$21.15');
// Promo + points together; nothing discounted → nothing stored / shown.
const both = buildPriceBreakdown({ subtotal: 40, promoCode: 'SAVE10', promoDiscount: 4, loyaltyPoints: 100, loyaltyDiscount: 5 });
assert.equal(discountSummary(both), '100 pts −$5.00 · promo SAVE10 −$4.00');
assert.deepEqual(discountLines(both).map(l => l.label), ['Promo SAVE10', 'Loyalty points (100 pts)']);
assert.equal(buildPriceBreakdown({ subtotal: 35, promoDiscount: 0, loyaltyDiscount: 0 }), null);
assert.equal(readPriceBreakdown(null), null);
assert.equal(readPriceBreakdown({ loyalty_discount: 'x' }), null, 'garbage is ignored');
assert.deepEqual(discountLines({ loyalty_discount: 21.15 }), [{ label: 'Loyalty points', amount: -21.15 }], 'backfill without points still shows');

// Wiring — written at booking/sale time, shown everywhere.
const src = f => fs.readFileSync(path.join(root, f), 'utf8');
assert(/price_breakdown: priceBreakdown/.test(src('src/app/api/book/in-person/route.ts')), 'in-shop booking stores it');
assert(/loyalty_discount: String\(redemption\.discount\)/.test(src('src/app/api/stripe/booking-checkout/route.ts')), 'online booking passes it through Stripe');
const fin = src('src/lib/finalize-booking-session.ts');
assert(/price_breakdown: priceBreakdown/.test(fin) && /discountSummary\(priceBreakdown\)/.test(fin) && /discounts: discountEmailField\(priceBreakdown\)/.test(fin), 'online booking stores it, alerts it and emails it');
assert(/fullRow\.price_breakdown = pb/.test(src('src/app/api/pos/cash-sale/route.ts')) && /fullRow\.price_breakdown = pb/.test(src('src/app/api/stripe/pos-finalize/route.ts')), 'POS cash + card sales store it');
assert(/const used = discountSummary\(/.test(src('src/lib/notify-staff-server.ts')), 'in-shop booking owner alert shows it');
assert(/discountLines\(\(appt as \{ price_breakdown\?: unknown \}\)\.price_breakdown\)/.test(src('src/components/calendar-view.tsx')), 'calendar booking panel shows it');
const pay = src('src/app/dashboard/payments/page.tsx');
assert(/discountLines\(i\.priceBreakdown\)/.test(pay) && /client_email, price_breakdown/.test(pay), 'Payments rows + detail show it');
assert(/\$\{discountRows\(data\.discounts\)\}/.test(src('src/lib/emailer.ts')), 'booking emails show it');
assert(/discounts: discountEmailField\(/.test(src('src/lib/notify-booking-emails.ts')), 'in-shop booking email shows it');
console.log('PASS price breakdown: promo + loyalty points recorded on bookings and POS sales, shown on calendar, Payments, alerts and emails (e.g. "Loyalty points (423 pts) −$21.15")');
