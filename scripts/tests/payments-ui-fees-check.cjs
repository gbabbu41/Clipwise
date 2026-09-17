const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript'), React = req('react'), { renderToStaticMarkup } = req('react-dom/server');
let states, cursor;
const source = fs.readFileSync(path.join(root, 'src/app/dashboard/payments/page.tsx'), 'utf8');
const stateNames = [...source.matchAll(/const \[([A-Za-z]\w*),[^\]]+\]\s*=\s*useState/g)].map(m => m[1]);
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
function render(overrides = {}) { cursor = 0; states = { loading: false, loadedShop: 'shop', feesStatus: 'ready', txs: [tx], ...overrides }; return renderToStaticMarkup(React.createElement(Page)); }
let html = render({ stripeNet: { connected: true, byPi: {}, available: 0, pending: 0 } });
assert(html.includes('Unavailable')); assert(html.includes('$115.00')); assert(html.includes('gross')); assert(!html.includes('Net may read a little high'));
html = render({ stripeNet: { connected: true, byPi: { pi_test: { gross: 115, fee: 3, net: 112 } }, available: 0, pending: 0 } });
assert(html.includes('$112.00')); assert(!html.includes('Unavailable'));
html = render({ txs: [{ ...tx, payment_method: 'cash', payment_intent_id: null }] });
assert(html.includes('$115.00')); assert(!html.includes('Unavailable'));
html = render({ selectedBarber: 'barber', barbers: [{ id: 'barber', name: 'QA barber', commission_percent: 50 }], stripeNet: null });
assert(html.includes('$50.00')); assert(!html.includes('Unavailable'));
for (const state of [{ loading: true }, { loadedShop: 'previous-shop' }, { loadError: true }]) { html = render(state); assert(!html.includes('$115.00')); assert(!html.includes('$0.00')); }
console.log('PASS Payments UI missing/known card fees, cash-only, barber take-home, loading/error/shop scope');
