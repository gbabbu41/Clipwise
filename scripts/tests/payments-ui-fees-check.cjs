const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript'), React = req('react'), { renderToStaticMarkup } = req('react-dom/server');
let states, cursor;
const source = fs.readFileSync(path.join(root, 'src/app/dashboard/payments/page.tsx'), 'utf8');
const stateNames = [...source.matchAll(/const \[([A-Za-z]\w*)?,[^\]]+\]\s*=\s*useState/g)].map(m => m[1]);
function load(file) {
  const filename = path.join(root, file), m = new Module(filename, module); m.filename = filename;
  m.require = id => {
    if (id === 'react') return { ...React, useState(init) { const key = stateNames[cursor++]; return [Object.hasOwn(states, key) ? states[key] : typeof init === 'function' ? init() : init, () => {}]; }, useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }) };
    if (id === '@/lib/auth-context') return { useAuth: () => ({ shop: { id: 'shop', name: 'Test shop', subscription_plan: 'premium', subscription_status: 'active' }, accessToken: 'test', user: { id: 'owner' } }) };
    if (id === '@/lib/validation') return { effectivePlan: () => 'premium', planHasFeature: () => true };
    if (id === '@/lib/supabase') return { supabase: {} };
    if (id === '@/lib/utils') return { formatCurrency: n => `$${n.toFixed(2)}`, cn: (...v) => v.filter(Boolean).join(' '), timeAgo: () => '', timeToMinutes: () => 0 };
    if (id.startsWith('@/components/')) return { useConfirm: () => ({ confirm: async () => true }), FeatureLock: () => null, DashboardHeader: () => null };
    return id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : req(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return m.exports;
}
const Page = load('src/app/dashboard/payments/page.tsx').default;
const tx = { id: 'tx', client_name: 'QA client', service_name: 'Service', amount: 100, tax: 15, tip: 0, source: 'pos', payment_method: 'card', payment_intent_id: 'pi_test', created_at: new Date().toISOString(), barber_id: 'barber', commission_amount: 50 };
function render(overrides = {}) { cursor = 0; states = { loading: false, loadedShop: 'shop', loadedScope: JSON.stringify(['shop', 'owner', 'test']), feesStatus: 'ready', showDetails: true, txs: [tx], ...overrides }; return renderToStaticMarkup(React.createElement(Page)); }
// Financial assertions inspect the expanded receipt; More hides these rows by design.
const collapsed = render({ showDetails: false });
assert(collapsed.includes('aria-expanded="false"'));
assert(collapsed.includes('More'));
// Decluttered: no On-file / Outstanding tiles, no tax link, no swipe hint.
assert(!collapsed.includes('On file') && !collapsed.includes('cwp-tile') && !collapsed.includes('Tax collected') && !collapsed.includes('swipe periods'));
let html = render({ stripeNet: { connected: true, byPi: {}, available: 0, pending: 0 } });
// No live fee AND no recorded fee → the card fee is ESTIMATED (2.9% + 30¢, rounded
// up), never "Unavailable". Gross stays $115.00; Net is the ≈-marked estimate
// (115 − 3.64 = 111.36) with an "(est.)" fee line. See KNOWLEDGE-BOOK §3.8.
assert(!html.includes('Unavailable'));
assert(html.includes('$115.00'));   // gross taken in
assert(html.includes('$111.36'));   // net after the estimated fee
assert(html.includes('≈'));         // estimate marker
assert(html.includes('(est.)'));    // estimated-fee label
// Collapsed card: only the Collected headline — the Stripe fee line and gross sit behind "More".
html = render({ showDetails: false, stripeNet: { connected: true, byPi: {}, available: 0, pending: 0 } });
assert(html.includes('$111.36') && !html.includes('(est.)') && !html.includes('Stripe fees') && !html.includes('$115.00'));
html = render({ stripeNet: { connected: true, byPi: { pi_test: { gross: 115, fee: 3, net: 112 } }, available: 0, pending: 0 } });
assert(html.includes('$112.00')); assert(!html.includes('Unavailable'));
// Platform fee ESTIMATE rate (super-admin setting) changes only the estimate:
// 115 × 3.7% + $0.30 = $4.56 → ≈ $110.44 …
html = render({ stripeNet: { connected: true, byPi: {}, available: 0, pending: 0, feeEstimate: { percent: 3.7, fixed: 0.3 } } });
assert(html.includes('$110.44') && html.includes('(est.)') && !html.includes('$111.36'), 'estimate follows the platform rate');
// … and never a confirmed Stripe fee.
html = render({ stripeNet: { connected: true, byPi: { pi_test: { gross: 115, fee: 3, net: 112 } }, available: 0, pending: 0, feeEstimate: { percent: 9, fixed: 2 } } });
assert(html.includes('$112.00') && !html.includes('(est.)'), 'confirmed fee ignores the estimate rate');
// A malformed rate falls back to the default estimate (2.9% + $0.30).
html = render({ stripeNet: { connected: true, byPi: {}, available: 0, pending: 0, feeEstimate: { percent: 50, fixed: -1 } } });
assert(html.includes('$111.36'), 'out-of-range rate → default estimate');
html = render({ txs: [{ ...tx, payment_method: 'cash', payment_intent_id: null }] });
assert(html.includes('$115.00')); assert(!html.includes('Unavailable'));
html = render({ selectedBarber: 'barber', barbers: [{ id: 'barber', name: 'QA barber', commission_percent: 50 }], stripeNet: null });
assert(html.includes('$50.00')); assert(!html.includes('Unavailable'));
for (const state of [{ loading: true }, { loadedShop: 'previous-shop' }, { loadedScope: 'previous-account' }, { loadError: true }]) { html = render(state); assert(!html.includes('$115.00')); assert(!html.includes('$0.00')); }
html = render({ txs: [{ ...tx, stripe_fee: 0 }], stripeNet: { connected: true, byPi: { pi_test: { gross: 115, fee: 3, net: 112 } }, available: 0, pending: 0 } });
assert(html.includes('$112.00')); assert(!html.includes('$111.36')); assert(!html.includes('(est.)'), 'resolved summary fee wins over old DB snapshot and is deducted once');
// Transaction list follows the selected carousel card: Today (default) hides an
// older sale; the All time card (index 3) shows it.
const old = { ...tx, id: 'old', client_name: 'Older client', created_at: new Date(Date.now() - 3 * 86400000).toISOString() };
html = render({ txs: [tx, old] });
assert(html.includes('QA client') && !html.includes('Older client'), 'Today card scopes the list to today');
html = render({ txs: [tx, old], netSlide: 3 });
assert(html.includes('QA client') && html.includes('Older client'), 'All time card shows every transaction');
// Long lists render 10 rows + a "Load more" button; totals still use every row.
const many = Array.from({ length: 13 }, (_, n) => ({ ...tx, id: 'm' + n, client_name: 'Client ' + n }));
html = render({ txs: many });
assert(html.includes('Load 3 more · 3 left'), 'load-more button for rows beyond the first 10');
assert.equal((html.match(/Client \d+/g) || []).length, 10, 'only 10 rows drawn');
html = render({ txs: many, visibleTx: 30 });
assert(!html.includes(' more · '), 'no button once every row is shown');
// Instant paint: a cached snapshot shows (marked "Updating…") while the fresh
// load runs, instead of the blank "Loading payments…" screen.
html = render({ loading: true, fromCache: true });
assert(html.includes('$115.00') && html.includes('Updating…') && !html.includes('Loading payments…'), 'cached snapshot paints while refreshing');
console.log('PASS Payments UI missing/known card fees, cash-only, barber take-home, loading/error/shop scope');
