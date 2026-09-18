const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/services/page.tsx'), 'utf8');
const start = source.indexOf('  const loadData = useCallback('), end = source.indexOf('\n  useEffect(', start);
assert(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup() {
  const state = { rows: ['previous'], loading: false, error: '', loadedShop: null, filters: [] }, pending = [];
  const env = { useCallback: fn => fn, activeShopId: { current: 'a' }, loadSequence: { current: 0 },
    setServices: v => { state.rows = v; }, setLoading: v => { state.loading = v; }, setLoadError: v => { state.error = v; },
    setLoadedShopId: v => { state.loadedShop = v; }, showToast: () => {},
    supabase: { from: table => {
      assert.equal(table, 'services'); let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); pending.push({ resolve, reject });
      const q = { select: () => q, eq: (k, v) => { state.filters.push([k, v]); return q; }, order: () => q, then: promise.then.bind(promise) }; return q;
    } } };
  return { state, env, pending, load: id => new Function('shop', ...Object.keys(env), `${handler}; return loadData;`)(id ? { id } : null, ...Object.values(env)) };
}
(async () => {
  for (const reply of [{ data: null, error: { message: 'private details' } }, { data: null, error: null }]) {
    const p = setup(), done = p.load('a')(); p.pending[0].resolve(reply); await done;
    assert.match(p.state.error, /Couldn't load/); assert.doesNotMatch(p.state.error, /private/); assert.equal(p.state.loading, false);
    const retry = p.load('a')(); p.pending[1].resolve({ data: [], error: null }); await retry;
    assert.equal(p.state.error, ''); assert.deepEqual(p.state.rows, []); assert.equal(p.state.loadedShop, 'a');
    assert.deepEqual(p.state.filters, [['shop_id', 'a'], ['shop_id', 'a']]);
  }
  const offline = setup(), failed = offline.load('a')(); offline.pending[0].reject(new Error('offline')); await failed;
  assert.match(offline.state.error, /connection/); assert.equal(offline.state.loading, false);
  const p = setup(), loadA = p.load('a'), old = loadA(); p.env.activeShopId.current = 'b'; const fresh = p.load('b')();
  p.pending[1].resolve({ data: ['b'], error: null }); await fresh; p.pending[0].resolve({ data: ['a'], error: null }); await old;
  assert.deepEqual(p.state.rows, ['b']); assert.equal(p.state.loadedShop, 'b'); await loadA(); assert.equal(p.pending.length, 2);
  const q = setup(), first = q.load('a')(), second = q.load('a')();
  q.pending[0].resolve({ data: null, error: {} }); await first; assert.equal(q.state.loading, true); assert.equal(q.state.error, '');
  q.pending[1].resolve({ data: ['new'], error: null }); await second; assert.deepEqual(q.state.rows, ['new']);
  const unmounted = setup(), abandoned = unmounted.load('a')(); unmounted.env.loadSequence.current++;
  unmounted.pending[0].resolve({ data: ['ignored'], error: null }); await abandoned; assert.deepEqual(unmounted.state.rows, ['previous']);
  p.env.activeShopId.current = undefined; await p.load(null)(); assert.deepEqual(p.state.rows, []); assert.equal(p.state.loadedShop, null);
  assert.match(source, /const listLoading = loading \|\| loadedShopId !== shop.id/);
  assert.match(source, /loadError \? \([\s\S]*?role="alert"[\s\S]*?onClick=\{loadData\}>Retry/);
  assert.match(source, /setShowServiceModal\(false\);\s+setEditService\(null\);\s+setNewSvc\(BLANK_SVC\);\s+setShowTemplates\(false\)/);
  assert.match(source, /const sequence = loadSequence;\s+loadData\(\);\s+return \(\) => \{ sequence.current\+\+; \}/);
  console.log('PASS service loading: read/missing-data/offline errors, retry, empty success, scoped queries, reversed requests, stale callbacks, unmount and cleared shop');
})().catch(error => { console.error(error); process.exitCode = 1; });
