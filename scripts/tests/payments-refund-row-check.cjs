const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/payments/page.tsx'), 'utf8');

// 2026-10-02 smoke test: a refund issued today didn't show under "Today".
// 1) The refund ledger row (source "refund") becomes its own row, dated at the refund.
const refundBlock = src.slice(src.indexOf('.filter(t => t.source === "refund")'));
assert.ok(src.includes('.filter(t => t.source === "refund")'), 'refund rows are in the feed');
assert.match(refundBlock.slice(0, 1200), /tsIso: t\.created_at/, 'dated when the money went back');
// ...and never counted: totals only take settled && !refunded lines.
assert.match(refundBlock.slice(0, 1200), /settled: false/);
assert.match(refundBlock.slice(0, 1200), /refunded: true, refundOut: true/);
assert.match(src, /const scopedSettled = feedAll\.filter\(i => i\.settled/);
assert.match(src, /items\.filter\(x => x\.settled && !x\.refunded\)/);
// 2) The refunded charge stays on the day it was PAID, not the day it was booked.
assert.match(src, /const tsIso = \(paid \|\| a\.payment_status === "refunded"\) \? \(a\.paid_at \?\? a\.created_at\) : a\.created_at;/);
// 3) Shown as money out, with no fee maths on it.
assert.match(src, /const statementAmount = \(i: FeedItem\) => \(i\.earn \|\| i\.refundOut\) \? i\.amount : netOf\(i\);/);
assert.match(src, /i\.refundOut \? "−"/);
assert.match(src, /Returned to customer/);
console.log('PASS payments refund row: refund shows on its own day as money out, never in totals; refunded charge stays on its paid day');
