const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = f => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');

// Owner rule (2026-10-02): money is reported on the day it MOVED — paid_at for a
// booking, created_at for a ledger row — never the day it was booked or scheduled.

// 1) "paid" and WHEN it was paid are written together (a best-effort follow-up
//    write could leave paid_at empty, and reports would fall back to booking day).
const capture = src('src/app/api/stripe/capture-appointment/route.ts');
assert.match(capture, /payment_status: "captured", payment_method: "card", paid_at: new Date\(\)\.toISOString\(\) \}\)/, '$0 settle stamps paid_at');
assert.match(capture, /payment_status: "captured", payment_method: "card", paid_at: new Date\(\)\.toISOString\(\), payment_intent_id/, 'capture stamps paid_at');
assert.doesNotMatch(capture, /\.update\(\{ paid_at:/, 'no separate best-effort paid_at write');
const inPerson = src('src/app/api/book/in-person/route.ts');
assert.match(inPerson, /payment_status: "paid", paid_at: new Date\(\)\.toISOString\(\) \}/);
assert.doesNotMatch(inPerson, /tax_amount: taxAmt, paid_at/);

// 2) Reports bucket booking money by paid_at.
const tax = src('src/app/dashboard/payments/tax/page.tsx');
assert.match(tax, /\.gte\("paid_at", from\)\.lte\("paid_at", to\)/, 'tax: by collection date');
assert.doesNotMatch(tax, /\.gte\("date"/);
assert.match(tax, /monthOf\(x\.paid_at\)/);
const digest = src('src/app/api/cron/reminders/route.ts');
assert.match(digest, /\.gte\("paid_at", looseFrom\)\.lte\("paid_at", looseTo\)/, 'weekly email: by paid day');
assert.match(digest, /filter\(a => inWeek\(a\.paid_at\)\)/);
assert.match(digest, /ymdInTz\(iso, tz\)/, 'shop-local day');
const dash = src('src/app/dashboard/page.tsx');
assert.match(dash, /const paidCompleted = revenueApptsInRange\.filter/, 'dashboard avg ticket: paid in window');
const analytics = src('src/app/dashboard/analytics/page.tsx');
assert.match(analytics, /const paidCompletedInRange = revenueApptsInRange\.filter/, 'analytics avg ticket: paid in period');
assert.match(analytics, /const bPaid = paidCompletedInRange\.filter/, 'per-barber revenue: paid in period');

// 3) ymdInTz gives the shop-local day.
const Module = require('node:module'), root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
const f = path.join(root, 'src/lib/timezone.ts'), m = new Module(f, module); m.require = req;
m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
assert.equal(m.exports.ymdInTz('2026-10-02T02:30:00Z', 'America/Halifax'), '2026-10-01', '11:30pm Halifax is still Oct 1');
assert.equal(m.exports.ymdInTz('2026-10-02T14:49:00Z', 'America/Halifax'), '2026-10-02');
console.log('PASS money dating: paid status + paid_at written together; tax, weekly email, dashboard + analytics avg ticket and per-barber revenue all dated by when the money moved (shop-local day)');
