const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const baseline = file => cp.execFileSync('git', ['show', '724ec2c:' + file], { cwd: root, encoding: 'utf8' });
function expression(source, name) {
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let result;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert(result, name); return result;
}
function compile(source, names, env) {
  const code = names.map(name => `const ${name} = ${expression(source, name)};`).join('\n');
  return new Function(...Object.keys(env), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + `;return {${names.join(',')}};`)(...Object.values(env));
}
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function clock() {
  const c = { now: 0, tasks: [], delay(ms, value, fail = false) { return new Promise((resolve, reject) => c.tasks.push({ at: c.now + ms, run: () => fail ? reject(Error('offline')) : resolve(value) })); },
    async advance(to) { for (;;) { c.tasks.sort((a,b) => a.at-b.at); const next = c.tasks[0]; if (!next || next.at > to) break; c.tasks.shift(); c.now = next.at; next.run(); await flush(); } c.now = to; await flush(); } };
  return c;
}
function database(c, home, fail) {
  return { from(table) {
    let revenue = false;
    const q = new Proxy({}, { get(_, method) { if (method === 'range') return () => c.delay(home ? table === 'barbers' ? 60 : table === 'transactions' || revenue ? 200 : 40 : 100,
      [{ id: table, is_active: true, stripe_fee: null }], fail === table);
      return (...args) => { if (method === 'in' && args[0] === 'payment_status') revenue = true; return q; }; } }); return q;
  } };
}
function payments(source, failure) {
  const c = clock(), state = { requests: [], events: [] };
  const env = { shop: { id: 'shop' }, user: { id: 'owner' }, accessToken: 'token', paymentScope: 'scope', paymentScopeRef: { current: 'scope' }, mountedRef: { current: true }, stripeRequestRef: { current: null }, stripeSequence: { current: 0 }, loadSequence: { current: 0 },
    useCallback: fn => fn, supabase: database(c, false, failure === 'db' ? 'transactions' : null), readAllRows: fn => fn(0, 499), AbortSignal: { timeout: () => undefined },
    fetch: async () => { state.requests.push(c.now); return c.delay(200, { ok: true, json: async () => ({ connected: true, byPi: { pi: { gross: 115, fee: 3, net: 112 } }, available: 0, pending: 0 }) }, failure === 'stripe'); } };
  for (const name of ['setLoading','setLoadError','setAppts','setTxs','setLoadedShop','setLoadedScope','setStripeNet','setFeesStatus']) env[name] = value => { const key = name.slice(3); state[key] = typeof value === 'function' ? value(state[key]) : value; state.events.push({ key, time: c.now }); };
  return { c, state, env, ...compile(source, ['syncStripe','loadData'], env) };
}
function home(source, failure) {
  const c = clock(), state = { events: [] }, env = { shop: { id: 'shop' }, profile: { id: 'owner', role: 'shop_owner' }, myBarberId: null, dateFilter: 'today', customStart: '', customEnd: '', reportKey: 'scope', reportScopeRef: { current: 'scope' }, loadSequence: { current: 0 }, useCallback: fn => fn,
    getDateRange: () => ['2026-09-26','2026-09-26'], supabase: database(c, true, failure), readAllRows: fn => fn(0,499) };
  for (const name of ['setLoadingAppts','setLoadError','setLoadingSchedule','setScheduleError','setScheduleAppts','setLoadedScheduleKey','setAppointments','setTxns','setRevenueAppts','setFinancialBarbers','setBarbers','setLoadedReportKey']) env[name] = value => { const key = name.slice(3); state[key] = value; state.events.push({ key, time: c.now }); };
  return { c, state, env, ...compile(source, ['loadAppointments'], env) };
}
(async () => {
  const pfile = 'src/app/dashboard/payments/page.tsx', hfile = 'src/app/dashboard/page.tsx', psource = read(pfile), hsource = read(hfile);
  const old = payments(baseline(pfile)), fresh = payments(psource);
  const oldLoad = old.loadData(), load = fresh.loadData();
  const joined = fresh.syncStripe();
  assert.equal(fresh.state.requests.length, 1); assert.equal(old.state.requests.length, 0);
  await old.c.advance(100); await fresh.c.advance(100); await Promise.all([oldLoad, load]);
  assert.deepEqual(old.state.requests, [100]); assert.deepEqual(fresh.state.requests, [0]);
  assert.equal(fresh.state.Txs.length, 1); assert.equal(fresh.state.Loading, false);
  await fresh.c.advance(200); await joined; assert.equal(fresh.state.StripeNet.byPi.pi.fee, 3);
  assert.equal(fresh.state.Txs[0].stripe_fee, null, 'older DB read may have no fee: live summary must remain separate');
  await old.c.advance(300); assert.equal(old.state.StripeNet.byPi.pi.fee, 3);
  const again = fresh.syncStripe(); await fresh.c.advance(400); await again;
  assert.equal(fresh.state.requests.length, 2, 'later deliberate refresh remains available');
  const overlap = payments(psource); const one = overlap.loadData(), two = overlap.loadData();
  assert.equal(overlap.state.requests.length, 1); await overlap.c.advance(100); await Promise.all([one,two]);
  await overlap.c.advance(200); assert.equal(overlap.state.requests.length, 2, 'changed ledger joins one trailing summary');
  await overlap.c.advance(400); assert.equal(overlap.state.requests.length, 2);
  const switched = payments(psource), oldPending = switched.loadData();
  switched.env.paymentScopeRef.current = 'new-scope';
  const replacement = compile(psource, ['syncStripe','loadData'], { ...switched.env, paymentScope: 'new-scope', shop: { id: 'other-shop' }, accessToken: 'new-token' });
  const replacementLoad = replacement.loadData(); await switched.c.advance(300); await Promise.all([oldPending, replacementLoad]);
  assert.equal(switched.state.LoadedScope, 'new-scope'); assert.equal(switched.state.LoadedShop, 'other-shop');
  assert.equal(switched.state.events.filter(e => e.key === 'Txs').length, 1, 'late previous-shop response cannot publish');
  const remount = payments(psource), abandoned = remount.syncStripe();
  remount.env.stripeSequence.current++; remount.env.stripeRequestRef.current = null;
  const remounted = remount.syncStripe(); await remount.c.advance(300); await Promise.all([abandoned,remounted]);
  assert.equal(remount.state.events.filter(e => e.key === 'StripeNet').length, 1, 'effect replay rejects abandoned summary without coalescing into it');
  for (const mode of ['scope','unmount','sequence']) {
    const p = payments(psource), pending = p.loadData();
    if (mode === 'scope') p.env.paymentScopeRef.current = 'other-account-or-shop';
    if (mode === 'unmount') p.env.mountedRef.current = false;
    if (mode === 'sequence') { p.env.loadSequence.current++; p.env.stripeSequence.current++; }
    await p.c.advance(300); await pending;
    assert.equal(p.state.Txs, undefined); assert.equal(p.state.StripeNet, undefined, mode);
  }
  const brokenDB = payments(psource, 'db'), brokenLoad = brokenDB.loadData(); await brokenDB.c.advance(300); await brokenLoad;
  assert.equal(brokenDB.state.LoadError, true); assert.equal(brokenDB.state.Txs, undefined);
  const brokenStripe = payments(psource, 'stripe'), successfulDB = brokenStripe.loadData(); await brokenStripe.c.advance(300); await successfulDB;
  assert.equal(brokenStripe.state.FeesStatus, 'error'); assert.equal(brokenStripe.state.Txs.length, 1); assert.equal(brokenStripe.state.Loading, false);
  const hOld = home(baseline(hfile)), hNew = home(hsource), ho = hOld.loadAppointments(), hn = hNew.loadAppointments();
  await hOld.c.advance(60); await hNew.c.advance(60);
  assert.equal(hOld.state.Appointments, undefined); assert.equal(hNew.state.ScheduleAppts.length, 1);
  assert.equal(hNew.state.LoadingSchedule, false); assert.equal(hNew.state.Appointments, undefined, 'financial snapshot remains unpublished');
  assert.equal(hNew.state.Barbers.length, 1); assert.equal(hNew.state.FinancialBarbers, undefined);
  await hOld.c.advance(200); await hNew.c.advance(200); await Promise.all([ho,hn]);
  assert.deepEqual(hNew.state.Appointments, hOld.state.Appointments); assert.deepEqual(hNew.state.Txns, hOld.state.Txns);
  assert.deepEqual(hNew.state.RevenueAppts, hOld.state.RevenueAppts); assert.deepEqual(hNew.state.FinancialBarbers, hOld.state.FinancialBarbers);
  for (const mode of ['scope','unmount']) {
    const h = home(hsource), pending = h.loadAppointments();
    if (mode === 'scope') h.env.reportScopeRef.current = 'other'; else h.env.loadSequence.current++;
    await h.c.advance(300); await pending; assert.equal(h.state.ScheduleAppts, undefined); assert.equal(h.state.Appointments, undefined);
  }
  const financeFail = home(hsource, 'transactions'), failedFinance = financeFail.loadAppointments(); await financeFail.c.advance(300); await failedFinance;
  assert.equal(financeFail.state.ScheduleAppts.length, 1); assert.equal(financeFail.state.LoadError, true); assert.equal(financeFail.state.Appointments, undefined);
  const staffFail = home(hsource, 'barbers'), failedStaff = staffFail.loadAppointments(); await staffFail.c.advance(300); await failedStaff;
  assert.equal(staffFail.state.ScheduleError, true); assert.equal(staffFail.state.ScheduleAppts, undefined); assert.equal(staffFail.state.LoadError, true);
  console.log('PASS simulated same-delay comparison: Payments exact-fee readiness 300 -> 200ms; Home usable fresh schedule/staff 200 -> 60ms; unchanged financial snapshots, coalescing/trailing refresh, errors and stale account/shop/unmount guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
