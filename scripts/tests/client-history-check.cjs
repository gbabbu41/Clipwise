const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/clients/page.tsx'), 'utf8');
const start = source.indexOf('  const openClient = async'), end = source.indexOf('  const saveNotes', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const client = id => ({ id, name: id, shop_id: 'shop', email: `${id}@example.test`, phone: '555', notes: id, birthday: '' });
function setup() {
  const state = { selected: null, rows: ['old'], error: '', loading: false, notes: '', tab: '', filters: [] }, pending = [];
  const env = { shop: { id: 'shop' }, activeShopId: { current: 'shop' }, historySequence: { current: 0 }, BLANK_HAIR: {},
    setSelectedClient: v => { state.selected = v; }, setClientAppointments: v => { state.rows = v; }, setHistoryError: v => { state.error = v; }, setHistoryLoading: v => { state.loading = v; },
    setNotes: v => { state.notes = v; }, setActiveTab: v => { state.tab = v; }, setEditField: () => {}, setHairProfile: () => {}, setBirthday: () => {},
    clientToId: c => c.id, apptToId: a => a.client_id, sameIdentity: (a, b) => a === b,
    supabase: { from: table => {
      assert.equal(table, 'appointments'); let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); pending.push({ resolve, reject });
      const q = { select: () => q, eq(k, v) { state.filters.push([k, v]); return q; }, ilike: () => q, order: () => q, limit: () => q, then: promise.then.bind(promise) }; return q;
    } },
  };
  const finish = (offset, id, fail = -1) => pending.slice(offset, offset + 4).forEach((p, i) => p.resolve({ data: [{ id: 'appointment-' + id, client_id: id, date: '2026-09-18' }, { id: 'other', client_id: 'stranger' }], error: i === fail ? { message: 'private detail' } : null }));
  return { state, env, pending, finish, open: new Function(...Object.keys(env), `${handler}; return openClient;`)(...Object.values(env)) };
}
(async () => {
  const p = setup(); const a = p.open(client('a')); assert.deepEqual(p.state.rows, []); assert.equal(p.state.loading, true);
  const b = p.open(client('b')); p.finish(4, 'b'); await b; p.finish(0, 'a'); await a;
  assert.equal(p.state.selected.id, 'b'); assert.equal(p.state.rows.length, 1); assert.equal(p.state.rows[0].client_id, 'b'); assert.equal(p.state.loading, false);
  assert.ok(p.state.filters.filter(([key]) => key === 'shop_id').every(([, value]) => value === 'shop'));
  for (let failure = 0; failure < 4; failure++) {
    const q = setup(); const first = q.open(client('a')); q.finish(0, 'a', failure); await first;
    assert.match(q.state.error, /Couldn't load/); assert.doesNotMatch(q.state.error, /private/); assert.deepEqual(q.state.rows, []); assert.equal(q.state.loading, false);
    q.state.notes = 'unsaved draft'; q.state.tab = 'history'; const retry = q.open(client('a'), true); q.finish(4, 'a'); await retry;
    assert.equal(q.state.error, ''); assert.equal(q.state.notes, 'unsaved draft'); assert.equal(q.state.tab, 'history'); assert.equal(q.state.rows.length, 1);
  }
  const offline = setup(); const request = offline.open(client('a')); offline.pending[0].reject(new Error('offline')); offline.finish(0, 'a'); await request; assert.match(offline.state.error, /connection/); assert.equal(offline.state.loading, false);
  const switched = setup(); const old = switched.open(client('a')); switched.env.activeShopId.current = 'other'; switched.finish(0, 'a'); await old; assert.deepEqual(switched.state.rows, []);
  const count = switched.pending.length; await switched.open(client('b')); assert.equal(switched.pending.length, count);
  const unmounted = setup(); const abandoned = unmounted.open(client('a')); unmounted.env.historySequence.current++; unmounted.finish(0, 'a'); await abandoned; assert.deepEqual(unmounted.state.rows, []);
  assert.match(source, /selectedClient && selectedClient.shop_id === shop\?\.id/);
  console.log('PASS client history: reset on open, reversed requests, dedup/filter preservation, all read failures, retry preserves drafts, offline/shop/unmount guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
