const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/components/dashboard/add-self-barber-banner.tsx'), 'utf8');
const compile = (start, end) => ts.transpileModule(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const effectCode = compile('  // Look for a barber row', '  const addSelf =');
const handlerCode = compile('  const addSelf =', '  if (state ===');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(mode = 'success') {
  let release; const held = new Promise(resolve => { release = resolve; });
  const state = { view: 'needed', error: '', busy: false, uncertain: false, checked: '', requests: [], refreshes: 0, reloads: 0, timers: [], reads: [], filters: [] };
  let cleanup;
  const env = { user: { id: 'owner', email: 'owner@example.invalid' }, profile: { name: 'Owner' }, shop: { id: 'shop' }, accessToken: 'token', isOwner: true, isStarter: true,
    state: 'needed', userId: 'owner', shopId: 'shop', currentScope: 'owner:shop:true:true', bannerScope: { current: 'owner:shop:true:true' }, checkedScope: 'owner:shop:true:true', checkAttempt: 0,
    checkedRef: { current: false }, bannerContext: { current: 1 }, selfRequestState: { current: 'idle' }, reloadTimer: { current: null },
    useEffect: fn => { cleanup = fn(); }, setState: v => { state.view = v; }, setError: v => { state.error = v; }, setAdding: v => { state.busy = v; },
    setUncertain: v => { state.uncertain = v; }, setCheckedScope: v => { state.checked = v; },
    refreshShop: async () => { state.refreshes++; }, setTimeout: fn => { state.timers.push(fn); return state.timers.length; }, clearTimeout: () => {}, window: { location: { reload: () => { state.reloads++; } } },
    useBannerSlot: () => true, // coordinator stub: this test exercises addSelf, not the slot gate
    supabase: { from: table => { assert.equal(table, 'barbers'); const q = { select: () => q, eq: (k,v) => { state.filters.push([k,v]); return q; }, maybeSingle: () => new Promise((resolve,reject) => { state.reads.push({resolve,reject}); }) }; return q; } },
    fetch: async (url, options) => {
      state.requests.push({ url, options, body: JSON.parse(options.body) }); if (mode === 'held') await held; if (mode === 'offline') throw Error('offline');
      return { ok: !['reject','server'].includes(mode), status: mode === 'reject' ? 400 : mode === 'server' ? 503 : 200, json: async () => {
        if (mode === 'json') throw Error('bad json'); if (mode === 'malformed') return { barber: {} };
        if (mode === 'reject' || mode === 'server') return { error: 'rejected' };
        return { ok: true, ownerSelf: true, barber: { id: 'saved' } };
      } };
    } };
  return { state, env, release, effect: () => new Function(...Object.keys(env), effectCode)(...Object.values(env)), cleanup: () => cleanup?.(),
    add: () => new Function(...Object.keys(env), `${handlerCode}; return addSelf;`)(...Object.values(env))() };
}
(async () => {
  const failed = setup(); failed.effect(); failed.state.reads[0].resolve({ data: null, error: { message: 'private' } }); await flush();
  assert.equal(failed.state.view, 'error', 'failed lookup must not advertise a missing barber'); assert.doesNotMatch(failed.state.error, /private/);
  failed.cleanup(); failed.effect(); assert.equal(failed.state.reads.length, 2, 'effect must recheck after cleanup, including Strict Mode');
  failed.state.reads[1].resolve({ data: null, error: null }); await flush(); assert.equal(failed.state.view, 'needed');
  const exists = setup(); exists.effect(); exists.state.reads[0].resolve({ data: { id: 'saved' }, error: null }); await flush(); assert.equal(exists.state.view, 'hidden');
  const offlineRead = setup(); offlineRead.effect(); offlineRead.state.reads[0].reject(Error('offline')); await flush(); assert.equal(offlineRead.state.view, 'error');
  const moved = setup(); moved.effect(); moved.cleanup(); moved.env.shopId = 'other'; moved.env.currentScope = 'owner:other:true:true'; moved.effect();
  moved.state.reads[1].resolve({ data: { id: 'other-barber' }, error: null }); await flush(); moved.state.reads[0].resolve({ data: null, error: null }); await flush();
  assert.equal(moved.state.view, 'hidden'); assert.equal(moved.state.checked, 'owner:other:true:true');
  const stale = setup(); stale.effect(); stale.cleanup(); stale.state.reads[0].resolve({ data: null, error: null }); await flush(); assert.notEqual(stale.state.view, 'needed');
  const held = setup('held'), first = held.add(), second = held.add(); assert.equal(held.state.requests.length, 1); held.release(); await Promise.all([first,second]);
  assert.equal(held.state.view, 'ok'); assert.equal(held.state.refreshes, 1); assert.equal(held.state.requests[0].body.commission_percent, 0); assert.equal(held.state.requests[0].body.shop_id, 'shop');
  held.state.timers[0](); assert.equal(held.state.reloads, 1); await held.add(); assert.equal(held.state.requests.length, 1);
  for (const mode of ['offline','json','malformed','server']) { const p = setup(mode); await p.add(); assert.equal(p.state.busy, false); assert.equal(p.state.uncertain, true); assert.match(p.state.error, /Refresh and check/); await p.add(); assert.equal(p.state.requests.length, 1); assert.equal(p.state.refreshes, 0); }
  const rejected = setup('reject'); await rejected.add(); await rejected.add(); assert.equal(rejected.state.requests.length, 2); assert.equal(rejected.state.uncertain, false);
  const late = setup('held'), pending = late.add(); late.env.bannerContext.current++; late.release(); await pending; assert.equal(late.state.refreshes, 0); assert.equal(late.state.timers.length, 0);
  const timer = setup(); await timer.add(); timer.env.bannerContext.current++; timer.state.timers[0](); assert.equal(timer.state.reloads, 0);
  const transitionCode = compile('  const currentScope =', '  // Look for a barber row');
  const transitionEnv = { userId: 'owner', shopId: 'other', isOwner: true, isStarter: true, useRef: () => held.env.bannerScope, bannerContext: held.env.bannerContext, selfRequestState: held.env.selfRequestState };
  new Function(...Object.keys(transitionEnv), transitionCode)(...Object.values(transitionEnv)); assert.equal(held.env.selfRequestState.current, 'idle');
  for (const overrides of [{ isOwner: false }, { isStarter: false }, { state: 'error' }, { checkedScope: 'other' }, { accessToken: '' }]) {
    const p = setup(); Object.assign(p.env, overrides); await p.add(); assert.equal(p.state.requests.length, 0);
  }
  console.log('PASS self-barber banner: failed/strict-mode reads, existing rows, duplicate guard, uncertain lock, explicit retry, owner commission and stale response/timer isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
