const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript');
function load(file, mocks = {}) {
  const filename = path.join(root, file), mod = new Module(filename, module);
  mod.filename = filename;
  mod.require = id => mocks[id] ?? (id.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`)), mocks) : appReq(id));
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return mod.exports;
}
const periods = load('src/lib/analytics-period.ts');
const revenue = load('src/lib/revenue.ts');
const { analyticsPeriod, analyticsRevenueBuckets, timestampInPeriod, parseLocalDate, topServicesWithOther } = periods;
const week = analyticsPeriod('week', new Date(2026, 8, 20, 23, 30));
assert.equal(week.startDate, '2026-09-14'); assert.equal(week.endDate, '2026-09-21');
assert(timestampInPeriod(week.startIso, week)); assert(!timestampInPeriod(week.endIso, week));
assert(!timestampInPeriod(new Date(week.start.getTime() - 1).toISOString(), week));
assert.equal(analyticsPeriod('last', new Date(2026, 0, 1)).startDate, '2025-12-01');
assert.equal(analyticsPeriod('last', new Date(2026, 0, 1)).endDate, '2026-01-01');
assert.equal(analyticsPeriod('year', new Date(2026, 11, 31)).endDate, '2027-01-01');
for (const period of ['today', 'week', 'month', 'year']) {
  const toDate = analyticsPeriod(period, new Date(2026, 8, 17, 12));
  assert.equal(toDate.endDate, '2026-09-18');
  assert(!timestampInPeriod(new Date(2026, 8, 18, 0).toISOString(), toDate));
  const future = { client_name: 'Future', total_amount: 999, payment_status: 'paid', created_at: new Date(2026, 8, 18, 12).toISOString() };
  const futureBuckets = analyticsRevenueBuckets([future], [], toDate);
  assert.equal(futureBuckets.daily.reduce((sum, row) => sum + row.revenue, 0), 0);
  assert.equal(futureBuckets.daily.at(-1).date, '2026-09-17');
}
assert.equal(analyticsPeriod('week', new Date(2026, 8, 14)).startDate, '2026-09-14');
assert.equal(analyticsRevenueBuckets([], [], analyticsPeriod('week', new Date(2026, 8, 14))).daily.length, 1);
assert.equal(parseLocalDate('2026-09-17').getDate(), 17);
for (const [month, day] of [[2, 8], [10, 1]]) {
  const range = analyticsPeriod('week', new Date(2026, month, day, 12));
  assert.equal(analyticsRevenueBuckets([], [], range).daily.length, 7);
}
const stamp = day => new Date(2026, 8, day, 23, 30).toISOString();
const appts = [
  { client_name: 'Paid', total_amount: 115, tax_amount: 15, tip_amount: 10, payment_status: 'paid', paid_at: stamp(14), created_at: stamp(14), payment_intent_id: 'pi_booking', barber_id: 'owner' },
  { client_name: 'Unpaid', total_amount: 999, payment_status: 'pending', paid_at: stamp(15), created_at: stamp(15) },
  { client_name: 'Refund', total_amount: 888, payment_status: 'refunded', paid_at: stamp(16), created_at: stamp(16) },
];
const txs = [
  { client_name: 'Paid', amount: 115, payment_method: 'card', created_at: stamp(15) }, // legacy duplicate across dates
  { client_name: 'Paid', amount: 100, tip: 10, tax: 15, source: 'completion', payment_intent_id: 'pi_booking', payment_method: 'card', created_at: stamp(15) },
  { client_name: 'POS', amount: 20, tip: 3, tax: 3, source: 'pos', payment_method: 'cash', created_at: stamp(16) },
  { client_name: 'Paid', amount: 0, tip: 5, source: 'completion', payment_intent_id: 'pi_tip', payment_method: 'card', created_at: stamp(17) },
  { client_name: 'Refund', amount: 888, source: 'pos', refunded: true, payment_method: 'card', created_at: stamp(18) },
  { client_name: 'Balance', amount: 20, source: 'balance', payment_method: 'cash', created_at: stamp(19) },
];
const buckets = analyticsRevenueBuckets(appts, txs, week);
const totals = revenue.collectedTotals(appts, txs, {}, 'owner');
assert.equal(totals.gross, 156); // appointment 125 + POS service/tax/tip 26 + later tip 5
assert.equal(buckets.daily.length, 7); assert.equal(buckets.hourly.length, 24);
assert.equal(buckets.daily.reduce((sum, row) => sum + row.revenue, 0), totals.gross);
assert.equal(buckets.hourly.reduce((sum, row) => sum + row.revenue, 0), totals.gross);
assert.equal(buckets.daily[1].revenue, 0); assert.equal(buckets.daily[0].label, 'Sep 14');
assert.equal(totals.tips, 18); assert.equal(totals.ownerTips, 10);
assert(periods.hasMissingCardFees(appts, txs, {}));
assert(!periods.hasMissingCardFees(appts, txs, { pi_booking: { gross: 125, net: 121, fee: 4 }, pi_tip: { gross: 5, net: 4.5, fee: .5 } }));
assert(!periods.hasMissingCardFees([{ ...appts[0], tip_amount: 0, gift_applied: 115 }], [], {}));
assert(!periods.hasMissingCardFees([{ ...appts[0], payment_method: 'cash' }], [], {}));
assert(!periods.hasMissingCardFees([], [{ ...txs[1], tip: 0 }], {}));
assert(periods.hasMissingCardFees([], [{ ...txs[2], payment_method: 'card', payment_intent_id: null }], {}));
const services = topServicesWithOther({ A: 9, B: 8, C: 7, D: 6, E: 5, F: 4, G: 3, H: 2 });
assert.equal(services.at(-1).name, 'Other'); assert.equal(services.at(-1).value, 5);
assert.equal(services.reduce((sum, row) => sum + row.value, 0), 44);

if (process.argv.includes('--dates-only')) { console.log(`PASS analytics dates/reconciliation ${process.env.TZ}`); process.exit(0); }

// Exercise the real page's reads, loading/error UI and late-response guard.
const React = appReq('react'), renderer = appReq('react-test-renderer');
const { act } = renderer;
let auth = { shop: { id: 'shop-1', owner_id: 'owner', subscription_plan: 'pro' }, accessToken: 'token' };
let failTable = '', failFees = false, holdTransactions = false, held = [], queryLog = [];
const db = { from(table) {
  const filters = [];
  const query = new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve, reject) => {
      queryLog.push({ table, filters });
      const result = { data: [], error: table === failTable ? { message: 'sensitive backend error' } : null };
      if (table === 'transactions' && holdTransactions) return new Promise(done => held.push(() => done(result))).then(resolve, reject);
      return Promise.resolve(result).then(resolve, reject);
    };
    return (...args) => { filters.push([key, ...args]); return query; };
  } });
  return query;
} };
global.fetch = async () => ({ ok: failFees !== true, json: async () => ({ byPi: {}, ...(failFees === 'body' ? { error: 'Stripe unavailable' } : {}) }) });
const passthrough = name => ({ children, ...props }) => React.createElement(name, props, children);
const mocks = {
  '@/lib/auth-context': { useAuth: () => auth }, '@/lib/supabase': { supabase: db },
  '@/lib/utils': { cn: (...xs) => xs.join(' '), formatCurrency: v => `$${v.toFixed(2)}` },
  '@/lib/validation': { effectivePlan: p => p, isPaidPlan: () => true },
  '@/lib/revenue': revenue, '@/lib/analytics-period': periods, '@/lib/barber-earnings': { safeCommission: () => 0 },
  '@/lib/read-all-rows': load('src/lib/read-all-rows.ts'),
  '@/components/ui/avatar-image': { AvatarImage: passthrough('img') },
  '@/components/ui/button': { Button: passthrough('button') },
  '@/components/ui/card': Object.fromEntries(['Card', 'CardHeader', 'CardTitle', 'CardContent'].map(k => [k, passthrough('div')])),
  '@/components/dashboard/feature-lock': { FeatureLock: passthrough('div') },
  'lucide-react': { BarChart3: passthrough('i'), Building2: passthrough('i') },
  recharts: Object.fromEntries(['LineChart', 'Line', 'BarChart', 'Bar', 'PieChart', 'Pie', 'Cell', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'ResponsiveContainer'].map(k => [k, passthrough('div')])),
};
const Page = load('src/app/dashboard/analytics/page.tsx', mocks).default;
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  let view;
  failTable = 'appointments';
  await act(async () => { view = renderer.create(React.createElement(Page)); await flush(); });
  let output = JSON.stringify(view.toJSON());
  assert(output.includes('Analytics could not be loaded')); assert(!output.includes('sensitive backend error')); assert(!output.includes('Gross sales'));
  failTable = ''; failFees = true;
  await act(async () => { view.root.findAllByType('button').find(b => b.props.children === 'Retry analytics').props.onClick(); await flush(); });
  assert(JSON.stringify(view.toJSON()).includes('Analytics could not be loaded'));
  failFees = 'body';
  await act(async () => { view.root.findAllByType('button').find(b => b.props.children === 'Retry analytics').props.onClick(); await flush(); });
  assert(JSON.stringify(view.toJSON()).includes('Analytics could not be loaded'));
  failFees = false;
  await act(async () => { view.root.findAllByType('button').find(b => b.props.children === 'Retry analytics').props.onClick(); await flush(); });
  assert(JSON.stringify(view.toJSON()).includes('Gross sales'));
  const transactionQuery = queryLog.find(q => q.table === 'transactions');
  assert(transactionQuery.filters.some(f => f[0] === 'gte' && f[1] === 'created_at'));
  assert(transactionQuery.filters.some(f => f[0] === 'lt' && f[1] === 'created_at'));
  const barberQuery = queryLog.find(q => q.table === 'barbers');
  assert(!barberQuery.filters.some(f => f[0] === 'eq' && f[1] === 'is_active'), 'Historical financial attribution must include inactive barbers');
  holdTransactions = true;
  await act(async () => { view.root.findAllByType('button').find(b => b.props.children === 'This Week').props.onClick(); await flush(); });
  assert(!JSON.stringify(view.toJSON()).includes('Gross sales'));
  holdTransactions = false; failTable = 'services';
  await act(async () => { auth = { ...auth, shop: { ...auth.shop, id: 'shop-2' } }; view.update(React.createElement(Page)); await flush(); });
  await act(async () => { held.forEach(resolve => resolve()); await flush(); });
  output = JSON.stringify(view.toJSON());
  assert(output.includes('Analytics could not be loaded')); assert(!output.includes('Gross sales'));
  view.unmount();
  console.log('PASS analytics read errors, fee errors, retry, bounded queries, loading suppression and stale period/shop response guard');
})().catch(error => { console.error(error); process.exitCode = 1; });
