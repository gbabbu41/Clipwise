const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/components/waitlist-assign-sheet.tsx'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  useEffect(() => {\n    let alive = true;');
const end = source.indexOf('\n  const active =', start);
assert.ok(start >= 0 && end > start);
const effect = ts.transpileModule(source.slice(start, end).replace('(async () => {', 'pendingLoad = (async () => {'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const barber = id => ({ id, name: id, busy: [], blocked: [], start_time: '09:00', end_time: '17:00', fullDayOff: false });
const reply = barbers => new Response(JSON.stringify({ barbers }));
function setup() {
  const state = { loading: false, error: '', barbers: [barber('old')], slot: '10:00 AM', barberId: 'old', key: '', requests: [] };
  const pending = [];
  const env = {
    availabilityRetry: 0, slotsFor: b => b.id === 'free' ? ['10:00 AM'] : [],
    setLoading: v => { state.loading = v; }, setLoadError: v => { state.error = v; }, setBarbers: v => { state.barbers = v; }, setSlot: v => { state.slot = v; }, setLoadedAvailabilityKey: v => { state.key = v; },
    setBarberId: v => { state.barberId = v(state.barberId); },
    fetch: (url, options) => { state.requests.push({ url, body: JSON.parse(options.body) }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  };
  const run = (key = 'current', chosen = null, allowBarberSwitch = false) => new Function('request', 'availabilityKey', 'allowBarberSwitch', ...Object.keys(env), `let pendingLoad, cleanup; const useEffect = fn => { cleanup = fn(); }; ${effect}; return { cleanup, done: pendingLoad };`)(
    { id: 'waiter', shop_id: key, desired_date: '2030-09-18', barber_id: chosen }, key, allowBarberSwitch, ...Object.values(env));
  return { state, pending, run };
}
(async () => {
  for (const bad of [new Response('{}', { status: 503 }), new Response('bad-json'), new Response('{}'), new Response('null'), reply([{}]), reply([{ ...barber('bad'), busy: [null] }]), Error('offline')]) {
    const p = setup(), run = p.run(); assert.equal(p.state.loading, true); assert.equal(p.state.slot, null); assert.deepEqual(p.state.barbers, []);
    if (bad instanceof Error) p.pending[0].reject(bad); else p.pending[0].resolve(bad); await run.done;
    assert.equal(p.state.loading, false); assert.match(p.state.error, /Couldn't load open slots/); assert.deepEqual(p.state.barbers, []); assert.equal(p.state.key, 'current');
    run.cleanup(); const retry = p.run(); assert.equal(p.state.error, ''); p.pending[1].resolve(reply([barber('busy'), barber('free')])); await retry.done;
    assert.equal(p.state.error, ''); assert.equal(p.state.barberId, 'free'); assert.equal(p.state.loading, false);
  }
  const empty = setup(), e = empty.run(); empty.pending[0].resolve(reply([])); await e.done; assert.equal(empty.state.error, ''); assert.deepEqual(empty.state.barbers, []);
  const race = setup(), first = race.run('old'); first.cleanup(); const second = race.run('new'); race.pending[1].resolve(reply([barber('new')])); await second.done; race.pending[0].resolve(reply([barber('old')])); await first.done; assert.equal(race.state.key, 'new'); assert.equal(race.state.barbers[0].id, 'new');
  const gone = setup(), g = gone.run(); g.cleanup(); const snapshot = JSON.stringify(gone.state); gone.pending[0].reject(Error('late')); await g.done; assert.equal(JSON.stringify(gone.state), snapshot);
  for (const allow of [false, true]) { const p = setup(), r = p.run('shop', 'chosen', allow); p.pending[0].resolve(reply([barber('chosen'), barber('free')])); await r.done; assert.equal(p.state.barberId, 'chosen'); assert.deepEqual(p.state.requests[0].body, { shop_id: 'shop', date: '2030-09-18', barber_id: allow ? null : 'chosen' }); }
  assert.match(source, /loadedAvailabilityKey === availabilityKey && !loading && !loadError/);
  assert.match(source, /Retry loading slots/); assert.match(source, /availabilityKey, availabilityRetry\]/);
  console.log('PASS waitlist availability reads: HTTP/network/malformed failures, honest empty success, retry, cleared stale slots, late/unmounted responses, default barber and query scope preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
