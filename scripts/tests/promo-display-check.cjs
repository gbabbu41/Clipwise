const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const helperPath = path.resolve(__dirname, '../../src/lib/promo-display.ts');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helperModule = { exports: {} };
new Function('module', 'exports', compiled)(helperModule, helperModule.exports);
const { promoDisplay } = helperModule.exports;

const base = { total_uses: 2, uses_left: null, expires_at: null, is_active: true };
const unlimited = promoDisplay(base, '2026-09-29');
assert.equal(unlimited.status, 'Active');
assert.equal(unlimited.usesLabel, 'Unlimited');
assert.equal(unlimited.usagePercent, null);
assert.equal(unlimited.usageNote, 'No usage limit · 2 redemptions');

const exhausted = promoDisplay({ ...base, uses_left: 0 }, '2026-09-29');
assert.equal(exhausted.status, 'Limit reached');
assert.equal(exhausted.usesLabel, '0 / 2');
assert.equal(exhausted.usagePercent, 100);

const remaining = promoDisplay({ ...base, total_uses: 2, uses_left: 2 }, '2026-09-29');
assert.equal(remaining.status, 'Active');
assert.equal(remaining.usesLabel, '2 / 4');
assert.equal(remaining.usagePercent, 50);

assert.equal(promoDisplay({ ...base, expires_at: '2026-09-28' }, '2026-09-29').status, 'Expired');
assert.equal(promoDisplay({ ...base, expires_at: '2026-09-29' }, '2026-09-29').status, 'Active', 'Date-only expiry remains valid through the expiry date, matching server validation');
assert.equal(promoDisplay({ ...base, is_active: false, expires_at: '2026-09-28' }, '2026-09-29').status, 'Inactive');

const page = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/loyalty/page.tsx'), 'utf8');
assert.match(page, /const display = promoDisplay\(promo\)/);
assert.match(page, /display\.status === "Active" \? "success" : "danger"/);
assert.match(page, /display\.usagePercent !== null/);

console.log('PASS promo display: unlimited, capped remaining, exhausted, expiry date boundary, inactive status precedence, and card wiring');
