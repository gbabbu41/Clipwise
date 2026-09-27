const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript'), React = req('react'), { renderToStaticMarkup } = req('react-dom/server');
let states, cursor;
const src = fs.readFileSync(path.join(root, 'src/app/barber-dashboard/earnings/page.tsx'), 'utf8');
const stateNames = [...src.matchAll(/const \[([A-Za-z]\w*),[^\]]+\]\s*=\s*useState/g)].map(m => m[1]);
function load(file) {
  const filename = path.join(root, file), m = new Module(filename, module); m.filename = filename;
  m.require = id => {
    if (id === 'react') return { ...React, useState(init) { const key = stateNames[cursor++]; return [Object.hasOwn(states, key) ? states[key] : typeof init === 'function' ? init() : init, () => {}]; }, useEffect() {}, useCallback: fn => fn, useMemo: fn => fn(), useRef: v => ({ current: v }) };
    if (id === '@/lib/auth-context') return { useAuth: () => ({ accessToken: 't', profile: { role: 'barber' } }) };
    if (id === '@/lib/barber-context') return { useBarber: () => ({ shop: { id: 'shop' }, barber: { id: 'b', permissions: { view_earnings: true } } }) };
    if (id === '@/lib/supabase') return { supabase: {} };
    if (id === '@/lib/utils') return { formatCurrency: n => `$${n.toFixed(2)}`, cn: (...v) => v.filter(Boolean).join(' ') };
    if (id === '@/components/calendar-view') return { ApptDetail: () => null, Portal: ({ children }) => children, makeApptActions: () => ({}) };
    if (id === '@/components/ui/confirm-dialog') return { useConfirm: () => ({ confirm: async () => true }) };
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    return id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : req(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return m.exports;
}
const Page = load('src/app/barber-dashboard/earnings/page.tsx').default;
const mk = (n, daysAgo) => ({ id: 'x' + n + '_' + daysAgo, client_name: `Client${daysAgo}_${n}`, service_name: 'Cut', amount: 40, tip: 0, commission_amount: 20, payment_method: 'card', created_at: new Date(Date.now() - daysAgo * 86400000).toISOString() });
const txs = [...Array.from({ length: 13 }, (_, n) => mk(n, 0)), mk(99, 40)];
function render(o = {}) { cursor = 0; states = { loading: false, txs, pct: 50, ...o }; return renderToStaticMarkup(React.createElement(Page)); }
let html = render();
const firstCard = html.indexOf('cwp-pname'); assert(html.slice(firstCard, firstCard + 60).includes('Today'), 'Today is the first card');
assert(html.includes('Transactions<span class="font-normal text-grey"> · Today'), 'heading shows period');
assert.equal((html.match(/Client0_\d+/g) || []).length, 10, '10 of today\'s 13 rows drawn');
assert(!html.includes('Client40_99'), 'older sale hidden on Today');
assert(html.includes('Load 3 more · 3 left'), 'load more button');
html = render({ slide: 3, visibleTx: 50 });
assert(html.includes('Client40_99'), 'All time shows older sale'); assert(!html.includes(' more · '), 'no button when all shown');
console.log('PASS barber Payments: Today first, scoped list, 10 rows + load more, All time shows older');
