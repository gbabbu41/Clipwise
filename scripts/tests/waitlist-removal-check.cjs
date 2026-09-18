const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/waitlist-requests/page.tsx'), 'utf8');
const start = source.indexOf('  const removeEntry = async'), end = source.indexOf('  // Manually nudge', start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(result) {
  const state = { entries: [{ id: 'entry', status: 'waiting' }], busy: '', toasts: [], writes: 0, filters: [] };
  const q = { update(v) { state.writes++; assert.deepEqual(v, { status: 'cancelled' }); return q; }, eq(k, v) { state.filters.push([k, v]); return q; }, select(v) { assert.equal(v, 'id'); return q; }, maybeSingle: () => result() };
  const env = { shop: { id: 'shop' }, removalInFlight: { current: false }, supabase: { from: table => { assert.equal(table, 'appointment_waitlist'); return q; } }, setRemovingId: v => { state.busy = v; }, showToast: v => state.toasts.push(v), setEntries: fn => { state.entries = fn(state.entries); } };
  return { state, remove: new Function(...Object.keys(env), `${handler}; return removeEntry;`)(...Object.values(env)) };
}
(async () => {
  for (const result of [async () => ({ data: null, error: { message: 'private detail' } }), async () => ({ data: null, error: null }), async () => { throw new Error('offline'); }]) {
    const p = setup(result); await p.remove('entry'); assert.equal(p.state.entries[0].status, 'waiting'); assert.match(p.state.toasts[0], /Couldn't remove/); assert.equal(p.state.busy, '');
  }
  const success = setup(async () => ({ data: { id: 'entry' }, error: null })); await success.remove('entry'); assert.equal(success.state.entries[0].status, 'cancelled'); assert.deepEqual(success.state.filters, [['id', 'entry'], ['shop_id', 'shop']]); assert.equal(success.state.toasts[0], 'Removed from waitlist');
  let finish; const p = setup(() => new Promise(resolve => { finish = resolve; })); const saving = p.remove('entry'); await p.remove('entry'); assert.equal(p.state.writes, 1); assert.equal(p.state.busy, 'entry'); finish({ data: null, error: null }); await saving; const retry = p.remove('entry'); assert.equal(p.state.writes, 2); finish({ data: { id: 'entry' }, error: null }); await retry; assert.equal(p.state.entries[0].status, 'cancelled');
  console.log('PASS waitlist removal: failed/zero-row/offline saves preserve entry, confirmed shop-scoped save updates UI, duplicate guard and retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
