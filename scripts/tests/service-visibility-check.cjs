const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/services/page.tsx'), 'utf8');
const start = source.indexOf('  const toggleServiceActive = async'), end = source.indexOf('  const saveService', start);
assert(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(result = async () => ({ data: { id: 'svc', is_active: false }, error: null }), overrides = {}) {
  const service = { id: 'svc', shop_id: 'shop', is_active: true };
  const state = { rows: [service], writes: [], filters: [], toasts: [], pending: new Set() };
  const env = { shop: { id: 'shop' }, activeShopId: { current: 'shop' }, visibilityInFlight: { current: new Set() },
    setServices: fn => { state.rows = fn(state.rows); }, setVisibilityPending: fn => { state.pending = fn(state.pending); }, showToast: v => state.toasts.push(v),
    supabase: { from: table => {
      assert.equal(table, 'services');
      const q = { update: payload => { state.writes.push(payload); return q; }, eq: (k, v) => { state.filters.push([k, v]); return q; }, select: () => q, maybeSingle: result, then: (yes, no) => result().then(yes, no) }; return q;
    } }, ...overrides };
  return { service, state, env, toggle: new Function(...Object.keys(env), `${handler}; return toggleServiceActive;`)(...Object.values(env)) };
}
(async () => {
  for (const result of [async () => ({ data: null, error: null }), async () => ({ data: { id: 'svc' }, error: null }), async () => ({ data: null, error: { message: 'private details' } }), async () => { throw new Error('offline'); }]) {
    const p = setup(result); await p.toggle(p.service);
    assert.equal(p.state.rows[0].is_active, true, 'unconfirmed writes must preserve displayed visibility');
    assert.match(p.state.toasts[0], /Couldn't/); assert.doesNotMatch(p.state.toasts[0], /private/); assert.equal(p.state.pending.size, 0); assert.equal(p.env.visibilityInFlight.current.size, 0);
  }
  const p = setup(); await p.toggle(p.service); assert.equal(p.state.rows[0].is_active, false);
  assert.deepEqual(p.state.writes, [{ is_active: false }]); assert.deepEqual(p.state.filters, [['id', 'svc'], ['shop_id', 'shop']]);
  const authoritative = setup(async () => ({ data: { id: 'svc', is_active: true }, error: null })); await authoritative.toggle(authoritative.service); assert.equal(authoritative.state.rows[0].is_active, true);
  let finish; const duplicate = setup(() => new Promise(resolve => { finish = resolve; }));
  const first = duplicate.toggle(duplicate.service), second = duplicate.toggle(duplicate.service); assert.equal(duplicate.state.writes.length, 1);
  finish({ data: { id: 'svc', is_active: false }, error: null }); await Promise.all([first, second]); assert.equal(duplicate.state.pending.size, 0);
  for (const overrides of [{ shop: null }, { shop: { id: 'other' } }]) { const p = setup(undefined, overrides); await p.toggle(p.service); assert.equal(p.state.writes.length, 0); }
  const stale = setup(() => new Promise(resolve => { finish = resolve; })), done = stale.toggle(stale.service);
  stale.env.activeShopId.current = 'other'; finish({ data: { id: 'svc', is_active: false }, error: null }); await done;
  assert.equal(stale.state.rows[0].is_active, true); assert.deepEqual(stale.state.toasts, []);
  assert.match(source, /disabled=\{visibilityPending.has\(svc.id\)\}/);
  console.log('PASS service visibility: confirmed scoped updates, failed/offline/zero-row preservation, duplicate guard, shop isolation and pending cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
