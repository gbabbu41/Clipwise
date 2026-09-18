const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/loyalty/page.tsx'), 'utf8');
const start = source.indexOf('  const loadData = useCallback('), end = source.indexOf('\n  useEffect(', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup() {
  const state = { clients: ['previous'], promos: ['previous'], loading: false, error: '', history: false, shop: null, filters: [], computations: 0 };
  const pending = [];
  const env = {
    useCallback: fn => fn, loadSequence: { current: 0 }, activeShopId: { current: 'a' },
    setLoading: v => { state.loading = v; }, setLoadError: v => { state.error = v; },
    setHistoryUnavailable: v => { state.history = v; }, setLoadedShopId: v => { state.shop = v; },
    setClients: v => { state.clients = v; }, setPromos: v => { state.promos = v; },
    groupClients: ({ clientRows }) => { state.computations++; return clientRows.map(c => ({ ...c, total_visits: 7 })); },
    sameIdentity: (a, b) => a.id === b.id,
    supabase: { from(table) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      pending.push({ table, resolve, reject });
      const q = { select: () => q, eq(k, v) { state.filters.push([table, k, v]); return q; }, order: () => q, then: promise.then.bind(promise) };
      return q;
    } },
  };
  const makeLoad = id => new Function('shop', ...Object.keys(env), `${handler}; return loadData;`)(id ? { id } : null, ...Object.values(env));
  const finish = (offset, id, failure = -1) => pending.slice(offset, offset + 4).forEach((p, i) => p.resolve({ data: [{ id, loyalty_points: 25, total_visits: 3 }], error: i === failure ? { message: 'private detail' } : null }));
  return { state, env, pending, makeLoad, finish };
}
(async () => {
  for (const failure of [0, 1]) {
    const p = setup(); const done = p.makeLoad('a')(); p.finish(0, 'ignored', failure); await done;
    assert.match(p.state.error, /Couldn't load/); assert.doesNotMatch(p.state.error, /private/); assert.equal(p.state.loading, false);
    assert.deepEqual(p.state.clients, ['previous']); assert.deepEqual(p.state.promos, ['previous']);
    const retry = p.makeLoad('a')(); p.finish(4, 'fresh'); await retry;
    assert.equal(p.state.error, ''); assert.equal(p.state.clients[0].id, 'fresh'); assert.equal(p.state.clients[0].loyalty_points, 25); assert.equal(p.state.clients[0].total_visits, 7);
    assert.ok(p.state.filters.every(([, k, v]) => k === 'shop_id' && v === 'a'));
  }
  for (const failure of [2, 3]) {
    const p = setup(); const done = p.makeLoad('a')(); p.finish(0, 'client', failure); await done;
    assert.equal(p.state.error, ''); assert.equal(p.state.history, true); assert.equal(p.state.computations, 0); assert.equal(p.state.clients[0].loyalty_points, 25); assert.equal(p.state.promos[0].id, 'client');
    const retry = p.makeLoad('a')(); p.finish(4, 'client'); await retry; assert.equal(p.state.history, false); assert.equal(p.state.computations, 1);
  }
  const offline = setup(); const failed = offline.makeLoad('a')(); offline.pending[0].reject(new Error('offline')); offline.finish(0, 'ignored'); await failed; assert.match(offline.state.error, /connection/); assert.equal(offline.state.loading, false);
  const p = setup(); const loadA = p.makeLoad('a'); const old = loadA(); p.env.activeShopId.current = 'b'; const latest = p.makeLoad('b')(); p.finish(4, 'b'); await latest; p.finish(0, 'a'); await old;
  assert.equal(p.state.clients[0].id, 'b'); assert.equal(p.state.promos[0].id, 'b'); await loadA(); assert.equal(p.pending.length, 8);
  const q = setup(); const first = q.makeLoad('a')(); const second = q.makeLoad('a')(); q.finish(0, 'old', 0); await first; assert.equal(q.state.loading, true); assert.equal(q.state.error, ''); q.finish(4, 'new'); await second; assert.equal(q.state.clients[0].id, 'new');
  const unmounted = setup(); const abandoned = unmounted.makeLoad('a')(); unmounted.env.loadSequence.current++; unmounted.finish(0, 'ignored'); await abandoned; assert.deepEqual(unmounted.state.clients, ['previous']);
  p.env.activeShopId.current = undefined; await p.makeLoad(null)(); assert.deepEqual(p.state.clients, []); assert.deepEqual(p.state.promos, []);
  assert.match(source, /if \(loadedShopId !== shop.id\) return/);
  assert.equal((source.match(/loadError \? loadFailure/g) || []).length, 2);
  assert.match(source, /historyUnavailable \? "—" : client.total_visits/);
  assert.match(source, /setAddPointsFor\(null\);\s+setRedeemFor\(null\);\s+setShowPromoModal\(false\)/);
  const settingsStart = source.indexOf('  // Load persisted loyalty settings');
  const settingsEnd = source.indexOf('  const saveSettings', settingsStart);
  const hydration = ts.transpileModule(source.slice(settingsStart, settingsEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let settings, reminders;
  const hydrate = booking_settings => new Function('shop', 'useEffect', 'setSettings', 'setReminders', hydration)(
    { booking_settings }, fn => fn(), v => { settings = v; }, v => { reminders = v; });
  hydrate({ loyalty: { enabled: false, points_per_visit: 77, points_per_dollar: 2, redemption_rate: 9 }, reminders: { birthday: true } });
  assert.equal(settings.points_per_visit, 77); assert.equal(settings.enabled, false); assert.equal(reminders.birthday, true);
  hydrate(null);
  assert.deepEqual(settings, { enabled: true, points_per_visit: 10, points_per_dollar: 1, redemption: 5 });
  assert.deepEqual(reminders, { appointment_24h: true, rebooking_30d: true, birthday: false, winback_60d: false });
  console.log('PASS loyalty loading: core/history errors, retry, scoped reads, stale responses/callbacks, unmount, cleared shop, unknown visit history and preserved point balances');
})().catch(error => { console.error(error); process.exitCode = 1; });
