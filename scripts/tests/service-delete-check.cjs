const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/services/page.tsx'), 'utf8');
const start = source.indexOf('  const deleteService = async'), end = source.indexOf('\n  if (!shop)', start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(read = async () => ({ count: 0, error: null }), remove = async () => ({ data: { id: 'service' }, error: null })) {
  const state = { busy: false, services: [{ id: 'service' }], confirm: 'service', deletes: 0, filters: [], toasts: [] };
  const env = { shop: { id: 'shop' }, activeShopId: { current: 'shop' }, deletionInFlight: { current: false },
    setDeleting: v => { state.busy = v; }, setServices: fn => { state.services = fn(state.services); }, setDeleteConfirm: v => { state.confirm = v; }, showToast: v => state.toasts.push(v),
    supabase: { from: table => { const q = { select: () => q, eq(k, v) { state.filters.push([table, k, v]); return q; }, gte: () => q, in: () => q, delete() { state.deletes++; return q; }, maybeSingle: remove, then: (yes, no) => read().then(yes, no) }; return q; } },
  };
  return { state, env, remove: new Function(...Object.keys(env), `${handler}; return deleteService;`)(...Object.values(env)) };
}
(async () => {
  for (const read of [async () => ({ count: null, error: { message: 'private' } }), async () => ({ count: null, error: null }), async () => { throw new Error('offline'); }, async () => ({ count: 2, error: null })]) {
    const p = setup(read); await p.remove('service'); assert.equal(p.state.deletes, 0); assert.equal(p.state.services.length, 1); assert.equal(p.state.busy, false); assert.doesNotMatch(p.state.toasts[0], /private/);
  }
  for (const remove of [async () => ({ data: null, error: null }), async () => ({ data: null, error: { message: 'private' } }), async () => { throw new Error('offline'); }]) {
    const p = setup(undefined, remove); await p.remove('service'); assert.equal(p.state.services.length, 1); assert.equal(p.state.confirm, 'service'); assert.equal(p.state.busy, false); assert.doesNotMatch(p.state.toasts[0], /Service deleted/);
  }
  const p = setup(); await p.remove('service'); assert.equal(p.state.services.length, 0); assert.equal(p.state.confirm, null);
  assert.deepEqual(p.state.filters, [['appointments', 'shop_id', 'shop'], ['appointments', 'service_id', 'service'], ['services', 'id', 'service'], ['services', 'shop_id', 'shop']]);
  let finish; const concurrent = setup(() => new Promise(resolve => { finish = resolve; })); const first = concurrent.remove('service'); await Promise.resolve(); await concurrent.remove('service'); assert.equal(concurrent.state.busy, true); finish({ count: 0, error: null }); await first; assert.equal(concurrent.state.deletes, 1);
  const switched = setup(async () => { switched.env.activeShopId.current = 'other'; return { count: 0, error: null }; }); await switched.remove('service'); assert.equal(switched.state.deletes, 0);
  console.log('PASS service deletion: failed/missing checks and upcoming bookings block writes, confirmed shop-scoped deletion only, failed outcomes preserve list, duplicate/shop-switch guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
