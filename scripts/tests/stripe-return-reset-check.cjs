// Smoke test (2026-09-30, live, iPhone): a customer went to the Stripe payment
// page, tapped Back to change the tip, and the booking page was stuck on
// "Booking…" — the browser restored it with its loading flag frozen. Every page
// that sends the browser off to Stripe (a server-provided *.url) must clear its
// loading state on return via useResetOnReturn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})(path.join(root, 'src'));

const redirectsOffsite = /window\.location\.(href\s*=|assign\()\s*[\w.]*\.url\b/;
const offenders = [], checked = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  if (!redirectsOffsite.test(s)) continue;
  checked.push(path.relative(root, f));
  if (!/useResetOnReturn\(/.test(s)) offenders.push(path.relative(root, f));
}
assert(checked.includes('src/app/book/[shopslug]/booking-client.tsx'), 'the customer booking page is covered');
assert(checked.includes('src/app/dashboard/gift-cards/page.tsx'), 'the gift-card Charge card page is covered');
assert.deepEqual(offenders, [], `pages that redirect to Stripe without useResetOnReturn: ${offenders.join(', ')}`);
console.log(`PASS Stripe return reset: all ${checked.length} pages that redirect to Stripe clear their loading state when the customer comes back`);
