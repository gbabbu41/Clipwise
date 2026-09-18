const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/loyalty/page.tsx'), 'utf8');
const start = source.indexOf('  const savePromo = async');
const end = source.indexOf('  const deletePromo', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ edit = true, result = async () => ({ data: { id: 'promo' }, error: null }), foreign = false } = {}) {
  const draft = { code: ' save10 ', discount_type: 'percent', discount_value: '10', uses_left: '20', expires_at: '', is_active: true };
  const state = { busy: false, open: true, draft, edit, calls: [], filters: [], toasts: [], reloads: 0 };
  const q = { eq(k, v) { state.filters.push([k, v]); return q; }, select(v) { assert.equal(v, 'id'); return q; }, maybeSingle: result };
  const env = {
    shop: { id: 'shop' }, newPromo: draft, editPromo: edit ? { id: 'promo', shop_id: foreign ? 'other' : 'shop', total_uses: 37 } : null,
    promoSaveInFlight: { current: false }, BLANK_PROMO: { code: '' },
    setSaving: v => { state.busy = v; }, showToast: v => state.toasts.push(v), loadData: () => { state.reloads++; },
    setShowPromoModal: v => { state.open = v; }, setEditPromo: v => { state.edit = v; }, setNewPromo: v => { state.draft = v; },
    supabase: { from(table) { assert.equal(table, 'promo_codes'); return {
      update(payload) { state.calls.push(['update', payload]); return q; },
      insert(payload) { state.calls.push(['insert', payload]); return result(); },
    }; } },
  };
  return { state, env, save: new Function(...Object.keys(env), `${handler}; return savePromo;`)(...Object.values(env)) };
}
(async () => {
  const edited = setup(); await edited.save();
  assert.equal(edited.state.calls[0][0], 'update'); assert.equal(Object.hasOwn(edited.state.calls[0][1], 'total_uses'), false);
  assert.equal(edited.state.calls[0][1].code, 'SAVE10'); assert.equal(edited.state.calls[0][1].discount_value, 10);
  assert.deepEqual(edited.state.filters, [['id', 'promo'], ['shop_id', 'shop']]);
  assert.equal(edited.state.open, false); assert.equal(edited.state.reloads, 1); assert.equal(edited.state.busy, false);
  const created = setup({ edit: false }); await created.save(); assert.equal(created.state.calls[0][1].total_uses, 0); assert.equal(created.state.open, false);
  for (const edit of [true, false]) {
    for (const result of [async () => ({ data: null, error: { message: 'private db detail' } }), async () => { throw new Error('offline'); }]) {
      const p = setup({ edit, result }); const draft = p.state.draft; await p.save();
      assert.equal(p.state.open, true); assert.equal(p.state.draft, draft); assert.equal(p.state.reloads, 0); assert.equal(p.state.busy, false);
      assert.match(p.state.toasts[0], /Couldn't/); assert.doesNotMatch(p.state.toasts[0], /private db detail/);
    }
  }
  const zero = setup({ result: async () => ({ data: null, error: null }) }); await zero.save(); assert.equal(zero.state.open, true);
  const foreign = setup({ foreign: true }); await foreign.save(); assert.equal(foreign.state.calls.length, 0);
  let finish; const p = setup({ result: () => new Promise(resolve => { finish = resolve; }) });
  const first = p.save(); await p.save(); assert.equal(p.state.calls.length, 1); assert.equal(p.state.busy, true);
  finish({ data: null, error: { message: 'failed' } }); await first;
  const retry = p.save(); assert.equal(p.state.calls.length, 2); finish({ data: { id: 'promo' }, error: null }); await retry;
  assert.equal(p.state.open, false); assert.equal(p.env.promoSaveInFlight.current, false);
  assert.match(source, /fieldset disabled=\{saving\}/);
  console.log('PASS promo save: usage preserved on edits, new usage initialized, scoped confirmed updates, failed drafts retained, offline/zero-row handling and duplicate guard');
})().catch(error => { console.error(error); process.exitCode = 1; });
