const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/waitlist-requests/page.tsx'), 'utf8');
const start = source.indexOf('  const load = useCallback(');
const end = source.indexOf('\n  useEffect(', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup() {
  const state = { entries: ['previous'], barbers: [], services: [], loading: false, error: '', shop: null, queries: [] };
  const pending = [];
  const env = {
    useCallback: fn => fn, loadSequence: { current: 0 }, activeShopId: { current: 'a' },
    setLoading: v => { state.loading = v; }, setLoadError: v => { state.error = v; },
    setLoadedShopId: v => { state.shop = v; }, setEntries: v => { state.entries = v; },
    setBarbers: v => { state.barbers = v; }, setServices: v => { state.services = v; },
    supabase: { from(table) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      pending.push({ table, resolve, reject });
      const q = { select: () => q, eq(k, v) { state.queries.push([table, k, v]); return q; }, gte: () => q, order: () => q, then: promise.then.bind(promise) };
      return q;
    } },
  };
  const makeLoad = id => new Function('shop', ...Object.keys(env), `${handler}; return load;`)(id ? { id } : null, ...Object.values(env));
  const finish = (offset, marker, failure = -1) => pending.slice(offset, offset + 3).forEach((p, i) => p.resolve({ data: [marker], error: i === failure ? { message: 'private database detail' } : null }));
  return { state, env, pending, makeLoad, finish };
}
(async () => {
  for (let failure = 0; failure < 3; failure++) {
    const p = setup(); const done = p.makeLoad('a')(); p.finish(0, 'ignored', failure); await done;
    assert.match(p.state.error, /Couldn't load/); assert.doesNotMatch(p.state.error, /private/);
    assert.deepEqual(p.state.entries, ['previous']); assert.equal(p.state.loading, false);
    const retry = p.makeLoad('a')(); assert.equal(p.state.error, ''); p.finish(3, 'fresh'); await retry;
    assert.deepEqual(p.state.entries, ['fresh']); assert.deepEqual(p.state.barbers, ['fresh']); assert.deepEqual(p.state.services, ['fresh']);
    assert.ok(p.state.queries.every(([, k, v]) => k === 'shop_id' && v === 'a'));
  }
  const offline = setup(); const failed = offline.makeLoad('a')(); offline.pending[0].reject(new Error('offline')); offline.finish(0, 'ignored'); await failed;
  assert.match(offline.state.error, /connection/); assert.equal(offline.state.loading, false);
  const p = setup(); const loadA = p.makeLoad('a'); const old = loadA();
  p.env.activeShopId.current = 'b'; const latest = p.makeLoad('b')(); p.finish(3, 'shop-b'); await latest;
  p.finish(0, 'shop-a'); await old; assert.deepEqual(p.state.entries, ['shop-b']); assert.equal(p.state.shop, 'b');
  await loadA(); assert.equal(p.pending.length, 6, 'Old location callbacks must not issue requests');
  const q = setup(); const first = q.makeLoad('a')(); const second = q.makeLoad('a')();
  q.finish(0, 'old', 0); await first; assert.equal(q.state.loading, true); assert.equal(q.state.error, '');
  q.finish(3, 'new'); await second; assert.deepEqual(q.state.entries, ['new']);
  const unmounted = setup(); const abandoned = unmounted.makeLoad('a')(); unmounted.env.loadSequence.current++;
  unmounted.finish(0, 'ignored'); await abandoned; assert.deepEqual(unmounted.state.entries, ['previous']);
  p.env.activeShopId.current = undefined; await p.makeLoad(null)(); assert.deepEqual(p.state.entries, []); assert.equal(p.state.loading, false);
  assert.match(source, /waitingForLoad \|\| loadError \? "—"/);
  assert.match(source, /assignReq && assignReq.shop_id === shop\?\.id/);
  assert.match(source, /return \(\) => \{ sequence.current\+\+; \}/);
  console.log('PASS waitlist loading: all query failures, offline recovery, retry, scoped reads, reversed location loads, same-shop races, unmount invalidation and cleared shop');
})().catch(error => { console.error(error); process.exitCode = 1; });
