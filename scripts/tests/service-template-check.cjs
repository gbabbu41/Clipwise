const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/services/page.tsx'), 'utf8');
const start = source.indexOf('  const addSelectedTemplates = async'), end = source.indexOf('  const deleteService', start);
assert(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(result = async () => ({ error: null }), overrides = {}) {
  const selected = new Set(['Haircut', 'Beard']);
  const state = { selected, busy: false, open: true, writes: [], toasts: [], reloads: 0 };
  const env = { shop: { id: 'shop' }, activeShopId: { current: 'shop' }, templateSaveInFlight: { current: false },
    SERVICE_TEMPLATES: [{ name: 'Haircut', price: 30, duration_minutes: 30, category: 'Hair', description: 'Cut' }, { name: 'Beard', price: 18, duration_minutes: 20, category: 'Beard', description: 'Trim' }],
    selectedTemplates: selected, existingNames: new Set(['beard']),
    setAddingTemplates: v => { state.busy = v; }, setShowTemplates: v => { state.open = v; }, setSelectedTemplates: v => { state.selected = v; },
    showToast: v => state.toasts.push(v), loadData: () => { state.reloads++; },
    supabase: { from: table => { assert.equal(table, 'services'); return { insert: payload => { state.writes.push(payload); return result(); } }; } }, ...overrides };
  return { state, env, save: new Function(...Object.keys(env), `${handler}; return addSelectedTemplates;`)(...Object.values(env)) };
}
(async () => {
  let finish;
  const duplicate = setup(() => new Promise(resolve => { finish = resolve; }));
  const first = duplicate.save(); const second = duplicate.save();
  assert.equal(duplicate.state.writes.length, 1, 'overlapping submissions must insert once');
  finish({ error: null }); await Promise.all([first, second]);
  assert.equal(duplicate.state.busy, false); assert.equal(duplicate.env.templateSaveInFlight.current, false);
  const success = setup(); await success.save();
  assert.deepEqual(success.state.writes, [[{ shop_id: 'shop', name: 'Haircut', price: 30, duration_minutes: 30, category: 'Hair', description: 'Cut', is_active: true, deposit_required: false, deposit_amount: 0 }]]);
  assert.equal(success.state.open, false); assert.equal(success.state.selected.size, 0); assert.equal(success.state.reloads, 1);
  for (const result of [async () => ({ error: { message: 'private database details' } }), async () => { throw new Error('offline'); }]) {
    const p = setup(result); const draft = p.state.selected; await p.save();
    assert.equal(p.state.selected, draft); assert.equal(p.state.open, true); assert.equal(p.state.busy, false);
    assert.equal(p.env.templateSaveInFlight.current, false); assert.equal(p.state.reloads, 0);
    assert.match(p.state.toasts[0], /Couldn't/); assert.doesNotMatch(p.state.toasts[0], /private database/);
  }
  for (const reply of [{ error: null }, { error: { message: 'rejected' } }]) {
    const p = setup(() => new Promise(resolve => { finish = resolve; })); const draft = p.state.selected;
    const saving = p.save(); p.env.activeShopId.current = 'other'; finish(reply); await saving;
    assert.equal(p.state.selected, draft); assert.equal(p.state.open, true); assert.equal(p.state.reloads, 0); assert.deepEqual(p.state.toasts, []);
  }
  for (const overrides of [{ shop: null }, { selectedTemplates: new Set() }, { existingNames: new Set(['haircut', 'beard']) }]) {
    const p = setup(undefined, overrides); await p.save(); assert.equal(p.state.writes.length, 0);
  }
  console.log('PASS service templates: duplicate guard, preserved payloads/selections, thrown/rejected saves, existing-name filtering and stale-shop suppression');
})().catch(error => { console.error(error); process.exitCode = 1; });
