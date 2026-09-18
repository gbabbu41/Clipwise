const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/onboarding/page.tsx'), 'utf8');
const start = source.indexOf('  const inviteBarber ='), end = source.indexOf('  const addSelfAsBarber =', start);
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(mode = 'success', overrides = {}) {
  let release; const held = new Promise(resolve => { release = resolve; });
  const state = { busy: false, error: '', uncertain: false, rows: [], ids: [], clears: 0, requests: [] };
  const env = { resumeReady: true, createdShopId: 'shop', accessToken: 'token', addedBarbers: [], planLimit: 3,
    barberRequestState: { current: 'idle' }, barberRequestContext: { current: 1 },
    setAddingBarber: v => { state.busy = v; }, setBarberError: v => { state.error = v; }, setBarberUncertain: v => { state.uncertain = v; },
    setAddedBarbers: fn => { state.rows = fn(state.rows); }, setCreatedBarberIds: fn => { state.ids = fn(state.ids); },
    setShowAddOther: () => { state.clears++; }, setOtherBarber: () => { state.clears++; }, setBlockHint: () => {},
    fetch: async (url, options) => {
      state.requests.push({ url, options, body: JSON.parse(options.body) });
      if (mode === 'held') await held;
      if (mode === 'offline') throw Error('offline');
      return { ok: !['reject', 'server'].includes(mode), status: mode === 'reject' ? 400 : mode === 'server' ? 503 : 200,
        json: async () => { if (mode === 'json') throw Error('bad json'); if (mode === 'malformed') return { ok: true, barber: {} };
          if (mode === 'reject' || mode === 'server') return { error: 'rejected' };
          return { ok: true, barber: { id: 'saved' }, emailed: true }; } };
    }, ...overrides };
  return { state, env, release, invite: new Function(...Object.keys(env), `${code}; return inviteBarber;`)(...Object.values(env)) };
}
const send = p => p.invite('Barber', 'barber@example.invalid', 65);
(async () => {
  const held = setup('held'), first = send(held), second = send(held); assert.equal(held.state.requests.length, 1, 'overlapping invitations must send once');
  held.release(); await Promise.all([first, second]); assert.deepEqual(held.state.ids, ['saved']); assert.equal(held.state.busy, false);
  assert.deepEqual(held.state.requests[0].body, { name: 'Barber', email: 'barber@example.invalid', commission_percent: 65, shop_id: 'shop' });
  assert.equal(held.state.requests[0].options.headers.Authorization, 'Bearer token');
  for (const mode of ['offline', 'json', 'malformed', 'server']) {
    const p = setup(mode); await send(p); assert.equal(p.state.busy, false); assert.equal(p.state.uncertain, true); assert.match(p.state.error, /Refresh and check/);
    assert.equal(p.state.clears, 0); assert.deepEqual(p.state.ids, []); await send(p); assert.equal(p.state.requests.length, 1);
  }
  const rejected = setup('reject'); await send(rejected); assert.equal(rejected.state.uncertain, false); assert.equal(rejected.state.clears, 0); await send(rejected); assert.equal(rejected.state.requests.length, 2);
  const stale = setup('held'), old = send(stale); stale.env.barberRequestContext.current++; stale.release(); await old;
  assert.deepEqual(stale.state.ids, []); assert.equal(stale.state.clears, 0); assert.equal(stale.state.error, '');
  for (const override of [{ createdShopId: '' }, { accessToken: '' }, { addedBarbers: [1,2,3] }]) { const p = setup('success', override); await send(p); assert.equal(p.state.requests.length, 0); }
  const proceedStart = source.indexOf('  const proceed ='), proceedEnd = source.indexOf('  // ── Step 2:', proceedStart);
  const proceedCode = ts.transpileModule(source.slice(proceedStart, proceedEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const requestState of ['pending', 'uncertain', 'idle']) {
    let advances = 0, hint = '';
    const env = { resumeReady: true, saving: false, step: 1, barberRequestState: { current: requestState }, canProceed: () => true, blockReason: () => 'blocked', setBlockHint: v => { hint = v; }, handleNext: () => { advances++; } };
    new Function(...Object.keys(env), `${proceedCode}; return proceed;`)(...Object.values(env))();
    assert.equal(advances, requestState === 'idle' ? 1 : 0); if (requestState !== 'idle') assert(hint);
  }
  assert.match(source, /fieldset disabled=\{addingBarber \|\| barberUncertain\}/);
  assert.match(source, /const addSelfAsBarber = \(\) => \{\s+if \(barberRequestState.current !== "idle"\) return/);
  assert.match(source, /const addOtherBarber = \(\) => \{\s+if \(barberRequestState.current !== "idle"\) return/);
  console.log('PASS onboarding invite controls: duplicate guard, uncertain outcome lock, retained rejected drafts/retry, stale context, payloads and prerequisite guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
