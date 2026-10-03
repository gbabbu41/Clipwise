const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/payments/page.tsx'), 'utf8');

// Refunds on Payments (owner rule 2026-10-02 — a statement, not a rewrite):
// 1) The refund row is its own line, dated at the refund, COUNTED as money out.
const at = src.indexOf('.filter(t => isRefundRow(t))');
assert.ok(at > 0, 'refund rows are in the feed');
const block = src.slice(at, at + 1400);
assert.match(block, /tsIso: t\.created_at/, 'dated when the money went back');
assert.match(block, /settled: true/, 'counted in that day');
assert.match(block, /refunded: true, refundOut: true/);
assert.match(block, /tax: -Math\.abs\(t\.tax \?\? 0\)/, 'tax given back');
// ...as a negative line with no fee of its own (Stripe keeps the sale's fee).
assert.match(src, /const counted = \(i: FeedItem\) => i\.giftBack \? 0 : i\.refundOut \? -i\.amount/, 'money refund subtracts; gift-card part moves no money');
assert.match(src, /const feeOf = \(i: FeedItem\) => i\.refundOut \? 0/);
assert.match(src, /const netOf = \(i: FeedItem\) => i\.refundOut \? counted\(i\)/);
assert.match(src, /const signedAmount = \(i: FeedItem\) => i\.earn \? i\.amount : netOf\(i\);/);
assert.match(src, /const settled = items\.filter\(x => x\.settled\);[\s\S]{0,120}signedAmount\(x\)/, 'day totals: refunds subtract');
assert.match(src, /filter\(i => !i\.giftSale && !i\.refundOut\)/, 'a refund is not a cut');
// 2) The refunded sale stays counted on the day it was PAID.
assert.match(src, /const tsIso = \(paid \|\| a\.payment_status === "refunded"\) \? \(a\.paid_at \?\? a\.created_at\) : a\.created_at;/);
assert.match(src, /settled: sale, tsIso,/);
assert.match(src, /settled: true, tsIso: t\.created_at,   \/\/ a refunded sale still happened/);
assert.match(src, /i\.refundOut && !i\.giftBack \? "−"/);
assert.match(src, /Returned to customer/);
console.log('PASS payments refund row: sale stays on its paid day, refund is money out on its own day (counted, no fee), never a cut');
