const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/onboarding/page.tsx'), 'utf8');
const start = source.indexOf('  // If the user reopens onboarding'), end = source.indexOf('  // Autofocus', start);
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  let cleanup;
  const state = { loading: true, error: '', owner: '', shop: '', slug: '', status: '', ids: [], team: [], reads: [], filters: [] };
  const env = { user: { id: 'owner', email: 'OWNER@example.invalid' }, createdShopId: '', resumeUserId: 'owner', resumeEmail: 'OWNER@example.invalid', resumeAttempt: 0,
    activeResumeUser: { current: 'owner' }, initialResumeUser: { current: undefined },
    useEffect: fn => { cleanup = fn(); }, setResumeLoading: v => { state.loading = v; }, setResumeError: v => { state.error = v; }, setResumeReadyFor: v => { state.owner = v; },
    setCreatedShopId: v => { state.shop = v; }, setCreatedShopSlug: v => { state.slug = v; }, setCreatedShopStatus: v => { state.status = v; }, setCreatedBarberIds: v => { state.ids = v; }, setAddedBarbers: v => { state.team = v; },
    supabase: { from: table => {
      const promise = new Promise((resolve, reject) => { state.reads.push({ table, resolve, reject }); });
      const q = { select: () => q, eq: (k,v) => { state.filters.push([table,k,v]); return q; }, order: (k,v) => { state.filters.push([table,'order',k,v]); return q; }, limit: v => { state.filters.push([table,'limit',v]); return q; }, then: promise.then.bind(promise) }; return q;
    } } };
  return { state, env, run: () => new Function(...Object.keys(env), code)(...Object.values(env)), cleanup: () => cleanup?.() };
}
const shop = { id: 'shop', slug: 'shop-slug', status: 'approved' };
(async () => {
  for (const reply of [{ data: null, error: { message: 'private' } }, { data: null, error: null }]) {
    const p = setup(); p.run(); p.state.reads[0].resolve(reply); await flush(); assert.match(p.state.error, /Couldn't load/); assert.equal(p.state.loading, false); assert.equal(p.state.owner, ''); assert.equal(p.state.shop, ''); assert.equal(p.state.reads.length, 1);
    p.cleanup(); p.run(); p.state.reads[1].resolve({ data: [], error: null }); await flush(); assert.equal(p.state.owner, 'owner'); assert.equal(p.state.error, '');
  }
  const p = setup(); p.run(); p.state.reads[0].resolve({ data: [shop], error: null }); await flush();
  assert.equal(p.state.shop, '', 'shop must not be published before team is confirmed');
  p.state.reads[1].resolve({ data: null, error: { message: 'private' } }); await flush(); assert.match(p.state.error, /Couldn't load/); assert.equal(p.state.owner, '');
  p.cleanup(); p.run(); p.state.reads[2].resolve({ data: [shop], error: null }); await flush();
  p.state.reads[3].resolve({ data: [{ id: 'barber', name: 'Owner', email: 'owner@example.invalid' }], error: null }); await flush();
  assert.equal(p.state.shop, 'shop'); assert.deepEqual(p.state.ids, ['barber']); assert.equal(p.state.team[0].self, true); assert.equal(p.state.owner, 'owner');
  assert(p.state.filters.some(row => row[0] === 'shops' && row[1] === 'limit' && row[2] === 1));
  assert(p.state.filters.some(row => row[0] === 'shops' && row[1] === 'order' && row[2] === 'created_at' && row[3].ascending));
  const offline = setup(); offline.run(); offline.state.reads[0].reject(Error('offline')); await flush(); assert.match(offline.state.error, /Couldn't load/);
  const late = setup(); late.run(); late.cleanup(); late.state.reads[0].resolve({ data: [shop], error: null }); await flush(); assert.equal(late.state.shop, ''); assert.equal(late.state.reads.length, 1);
  const changed = setup(); changed.run(); changed.env.activeResumeUser.current = 'other'; changed.env.resumeUserId = 'other'; changed.cleanup(); changed.run();
  changed.state.reads[0].resolve({ data: [shop], error: null }); await flush(); assert.equal(changed.state.shop, ''); assert.match(changed.state.error, /account changed/i); assert.equal(changed.state.reads.length, 1);
  for (const [name, endMarker] of [['handleNext', '  // Shared "advance this step"'], ['proceed', '  // ── Step 2:'], ['inviteBarber', '  const addSelfAsBarber =']]) {
    const from = source.indexOf(`  const ${name} =`), to = source.indexOf(endMarker, from);
    const handlerCode = ts.transpileModule(source.slice(from,to), { compilerOptions:{target:ts.ScriptTarget.ES2022} }).outputText;
    // Only resumeReady is provided: a blocked action must return before reading
    // any write dependencies, payloads or form state.
    await new Function('resumeReady',`${handlerCode}; return ${name};`)(false)();
  }
  assert.match(source, /if \(!resumeReady\) \{[\s\S]*?Retry loading setup/);
  assert.match(source, /\}, \[resumeUserId, resumeEmail, resumeAttempt\]\)/);
  console.log('PASS onboarding resume: shop/team failures, no partial publication, retry, empty success, offline/cleanup/account guards and oldest-shop selection');
})().catch(error => { console.error(error); process.exitCode = 1; });
