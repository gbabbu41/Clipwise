const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), React = appReq('react'), renderer = appReq('react-test-renderer');
const stub = name => ({ children, ...props }) => React.createElement(name, props, children);
const mocks = {
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' '), formatCurrency: value => `$${value.toFixed(2)}` },
  'lucide-react': new Proxy({}, { get: (_, name) => stub(String(name)) }),
  recharts: new Proxy({}, { get: (_, name) => stub(String(name)) }),
};
function load(file) {
  const filename = path.join(root, file), mod = new Module(filename, module);
  mod.filename = filename;
  mod.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id));
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return mod.exports;
}
const { readAllRows } = load('src/lib/read-all-rows.ts');
const { StatsCarousel } = load('src/components/dashboard/stats-carousel.tsx');
const props = { revenue: 115, taxCollected: 15, cashIncluded: 0, feesPaid: 0, tips: 0, commission: 50, netRevenue: 50, feesLoading: false, feesUnavailable: true, paidVisits: 1, appointments: [], completed: [], topBarbers: [], rangeStart: '2026-09-14', rangeEnd: '2026-09-17' };
(async () => {
  const calls = [];
  const records = Array.from({ length: 5 }, (_, id) => ({ id }));
  const rows = await readAllRows(async (from, to) => { calls.push([from, to]); return { data: records.slice(from, from + 2), error: null }; });
  assert.deepEqual(rows, records); assert.deepEqual(calls.map(([from]) => from), [0, 2, 4, 5]);
  await assert.rejects(readAllRows(async from => from === 0 ? { data: records.slice(0, 2), error: null } : { data: null, error: { message: 'failed page' } }), /Could not load complete records/);
  await assert.rejects(readAllRows(async () => ({ data: null, error: null })), /Could not load complete records/);
  let view;
  renderer.act(() => { view = renderer.create(React.createElement(StatsCarousel, props)); });
  let text = JSON.stringify(view.toJSON());
  assert(text.includes('Gross collected')); assert(text.includes('$115.00'));
  assert(text.includes('Processing fees unavailable')); assert(!text.includes('$50.00'));
  renderer.act(() => view.update(React.createElement(StatsCarousel, { ...props, feesLoading: true })));
  text = JSON.stringify(view.toJSON()); assert(text.includes('Checking processing fees')); assert(!text.includes('$50.00'));
  renderer.act(() => view.update(React.createElement(StatsCarousel, { ...props, feesUnavailable: false, revenue: 111, feesPaid: 4, netRevenue: 46 })));
  text = JSON.stringify(view.toJSON()); assert(text.includes('$111.00')); assert(text.includes('$115.00')); assert(text.includes('$46.00'));
  assert(text.includes('2026-09-14')); assert(text.includes('2026-09-17'));
  renderer.act(() => view.unmount());
  console.log('PASS dashboard carousel missing/loading/recovered fees and zero-day tables; pagination small server cap and failures reject partial reports');
})().catch(error => { console.error(error); process.exitCode = 1; });
