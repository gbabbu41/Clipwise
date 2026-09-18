const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/services/page.tsx'), 'utf8');
const start = source.indexOf('  const saveService = async'), end = source.indexOf('  const toggleTemplate', start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(result = async () => ({ data: { id: 'service' }, error: null }), overrides = {}) {
  const draft = { name: ' Haircut ', price: '30', duration_minutes: '45', category: 'Hair', description: 'Test', is_active: true, deposit_required: true, deposit_amount: '5' };
  const state = { draft, open: true, busy: false, writes: [], filters: [], toasts: [], reloads: 0 };
  const q = { eq(k, v) { state.filters.push([k, v]); return q; }, select: () => q, maybeSingle: result };
  const env = { shop: { id: 'shop' }, editService: { id: 'service', shop_id: 'shop' }, newSvc: draft, serviceSaveInFlight: { current: false }, activeShopId: { current: 'shop' },
    validatePrice: () => null, validateDuration: () => null, BLANK_SVC: {},
    setSaving: v => { state.busy = v; }, setShowServiceModal: v => { state.open = v; }, setEditService: () => {}, setNewSvc: v => { state.draft = v; }, showToast: v => state.toasts.push(v), loadData: () => { state.reloads++; },
    supabase: { from: table => { assert.equal(table, 'services'); return { update(payload) { state.writes.push(payload); return q; }, insert(payload) { state.writes.push(payload); return result(); } }; } }, ...overrides };
  return { state, env, save: new Function(...Object.keys(env), `${handler}; return saveService;`)(...Object.values(env)) };
}
(async () => {
  for (const edit of [true, false]) {
    const p = setup(undefined, edit ? {} : { editService: null }); await p.save(); assert.equal(p.state.open, false); assert.equal(p.state.busy, false); assert.equal(p.state.reloads, 1);
    assert.deepEqual(p.state.writes[0], { shop_id: 'shop', name: 'Haircut', price: 30, duration_minutes: 45, category: 'Hair', description: 'Test', is_active: true, deposit_required: false, deposit_amount: 0 });
    if (edit) assert.deepEqual(p.state.filters, [['id', 'service'], ['shop_id', 'shop']]);
    for (const reply of [async () => ({ data: null, error: { message: 'private' } }), async () => { throw new Error('offline'); }]) {
      const failure = setup(reply, edit ? {} : { editService: null }); const draft = failure.state.draft; await failure.save(); assert.equal(failure.state.open, true); assert.equal(failure.state.draft, draft); assert.equal(failure.state.busy, false); assert.equal(failure.state.reloads, 0); assert.match(failure.state.toasts[0], /Couldn't/); assert.doesNotMatch(failure.state.toasts[0], /private/);
    }
  }
  const zero = setup(async () => ({ data: null, error: null })); await zero.save(); assert.equal(zero.state.open, true);
  for (const overrides of [{ editService: { id: 'service', shop_id: 'other' } }, { validatePrice: () => 'Invalid price' }, { validateDuration: () => 'Invalid duration' }]) { const p = setup(undefined, overrides); await p.save(); assert.equal(p.state.writes.length, 0); }
  let finish; const p = setup(() => new Promise(resolve => { finish = resolve; })); const first = p.save(); await p.save(); assert.equal(p.state.writes.length, 1); finish({ data: null, error: null }); await first;
  const retry = p.save(); assert.equal(p.state.writes.length, 2); p.env.activeShopId.current = 'other'; finish({ data: { id: 'service' }, error: null }); await retry;
  assert.equal(p.state.open, true); assert.equal(p.state.reloads, 0); assert.equal(p.state.busy, false);
  assert.match(source, /fieldset disabled=\{saving\}/);
  console.log('PASS service saves: preserved payload/validation, scoped confirmed updates, failed drafts, offline/zero-row errors, duplicate guard and stale-shop response suppression');
})().catch(error => { console.error(error); process.exitCode = 1; });
