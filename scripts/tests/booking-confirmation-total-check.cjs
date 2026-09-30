// Smoke test 1 (2026-09-30): a pay-at-shop booking at a taxed, auto-confirm shop
// showed "Total $30" on the success screen (pre-tax) while $34.50 was saved and
// emailed, and the checkout said "reserved as pending" though it was confirmed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const src = f => fs.readFileSync(path.join(root, f), 'utf8');

const route = src('src/app/api/book/in-person/route.ts');
assert(/barber_id: inserted\.data\.barber_id,[\s\S]{0,200}total: grossTotal,/.test(route), 'server returns the saved total (service + tax)');
assert(/\.\.\.\(giftPaid \? \{ paid_with_gift: true, total: giftPaid\.gross/.test(route), 'gift path still overrides with what the card paid');

const client = src('src/app/book/[shopslug]/booking-client.tsx');
assert(/else if \(Number\.isFinite\(Number\(result\.total\)\)\) \{[\s\S]{0,700}total: Number\(result\.total\)/.test(client), 'success screen uses the server total');
assert(client.includes('const dispTotal = confirmedSummary?.total ?? grandTotal;'), 'fallback is the tax-inclusive total, never the pre-tax price');
assert(!/const dispTotal = confirmedSummary\?\.total \?\? total;/.test(client));
assert(/const autoConfirm = !!bookingSettings\?\.auto_confirm;/.test(client), 'checkout reads the shop auto-confirm setting');
assert(/autoConfirm \? "confirmed right away" : "reserved as pending until the shop confirms"/.test(client), 'pay-at-shop copy matches the real status');

const fin = src('src/lib/finalize-booking-session.ts');
assert(fin.includes('payment_method: isPayInPerson ? "cash" : "card",'), 'online-paid bookings record the card method (was blank)');
assert(/const amountStr = formatCurrency\(/.test(fin) && !/toFixed\(0\)/.test(fin), 'owner alert shows the exact amount ($15.93, not $16)');
assert(fin.includes('const friendly = prettyDateWithContext(m.date);'), 'owner alert date carries the weekday');
console.log('PASS booking confirmation: success screen shows the saved total incl. tax (server-authoritative), pay-at-shop copy follows auto-confirm, online booking alert shows exact amount + weekday, card method recorded');
