const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/loyalty/page.tsx'), 'utf8');
const start = source.indexOf('  const savePoints = async'), end = source.indexOf('  const loadData =', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(reply = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, loyalty_points: 110 }) }), overrides = {}) {
  const client = { id: 'client', shop_id: 'shop', name: 'Test', loyalty_points: 100 };
  const state = { clients: [client], error: '', uncertain: false, busy: false, addedClosed: false, redeemedClosed: false, toasts: [], calls: [] };
  const env = { shop: { id: 'shop' }, activeShopId: { current: 'shop' }, accessToken: 'test-token', addPointsFor: client, redeemFor: client,
    pointsToAdd: '10', pointsToRedeem: '20', pointsInFlight: { current: false }, pointsUncertain: false, settings: { redemption: 5 },
    setSavingPoints: v => { state.busy = v; }, setPointsError: v => { state.error = v; }, setPointsUncertain: v => { state.uncertain = v; },
    setClients: fn => { state.clients = fn(state.clients); }, showToast: v => state.toasts.push(v),
    setAddPointsFor: v => { state.addedClosed = v === null; }, setRedeemFor: v => { state.redeemedClosed = v === null; },
    fetch: async (url, options) => { assert.equal(url, '/api/loyalty/points'); assert.equal(options.headers.Authorization, 'Bearer test-token'); state.calls.push(JSON.parse(options.body)); return reply(); },
    ...overrides,
  };
  return { state, env, save: new Function(...Object.keys(env), `${handler}; return savePoints;`)(...Object.values(env)) };
}
(async () => {
  for (const mode of ['add', 'redeem']) {
    const p = setup(); await p.save(mode); assert.equal(p.state.clients[0].loyalty_points, 110); assert.equal(p.state.busy, false);
    assert.equal(mode === 'add' ? p.state.addedClosed : p.state.redeemedClosed, true);
    assert.deepEqual(p.state.calls[0], { client_id: 'client', points: mode === 'add' ? 10 : -20, shop_id: 'shop' });
    const rejected = setup(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Not enough points to redeem' }) })); await rejected.save(mode);
    assert.match(rejected.state.error, /Not enough/); assert.equal(rejected.state.addedClosed, false); assert.equal(rejected.state.redeemedClosed, false); assert.equal(rejected.state.clients[0].loyalty_points, 100); assert.equal(rejected.state.uncertain, false);
    for (const reply of [async () => { throw new Error('offline'); }, async () => ({ ok: false, status: 503, json: async () => ({ error: 'private' }) }), async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }), async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } })]) {
      const failed = setup(reply); await failed.save(mode); assert.equal(failed.state.uncertain, true); assert.match(failed.state.error, /reload the page/); assert.equal(failed.state.busy, false); assert.equal(failed.state.toasts.length, 0); assert.equal(failed.state.clients[0].loyalty_points, 100);
    }
  }
  for (const value of ['', '0', '-10', '1.5', 'Infinity', 'garbage']) { const p = setup(undefined, { pointsToAdd: value, pointsToRedeem: value }); await p.save('add'); await p.save('redeem'); assert.equal(p.state.calls.length, 0); }
  for (const overrides of [{ accessToken: null }, { pointsUncertain: true }, { addPointsFor: { id: 'client', shop_id: 'other' } }]) { const p = setup(undefined, overrides); await p.save('add'); assert.equal(p.state.calls.length, 0); }
  let finish; const p = setup(() => new Promise(resolve => { finish = resolve; })); const first = p.save('add'); await p.save('redeem'); assert.equal(p.state.calls.length, 1);
  finish({ ok: false, status: 400, json: async () => ({ error: 'bad input' }) }); await first; const retry = p.save('add'); assert.equal(p.state.calls.length, 2);
  p.env.activeShopId.current = 'other'; finish({ ok: true, status: 200, json: async () => ({ ok: true, loyalty_points: 110 }) }); await retry;
  assert.equal(p.state.clients[0].loyalty_points, 100); assert.equal(p.state.toasts.length, 0); assert.equal(p.state.busy, false);
  assert.equal((source.match(/loading=\{savingPoints\} disabled=\{pointsUncertain\}/g) || []).length, 2);
  console.log('PASS loyalty saves: confirmed balances, retained rejected drafts, uncertain response lock, input/shop/auth guards, double-click protection, retry and stale-shop response guard');
})().catch(error => { console.error(error); process.exitCode = 1; });
