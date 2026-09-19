const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/clients/page.tsx'), 'utf8');
const profile = source.slice(source.indexOf('  const saveNotes ='), source.indexOf('  const sendBirthdayEmail ='));
const points = source.slice(source.indexOf('  const addPoints ='), source.indexOf('  const addClient ='));
const handlers = ts.transpileModule(profile + points, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(selection, currentField = 'email', currentDraft = 'new@example.test') {
  const original = { id: 'original', shop_id: 'shop', notes: 'before', birthday: '', email: 'old@example.test', loyalty_points: 10 };
  const state = { selected: selection, clients: [original], field: currentField, writes: [] };
  const env = {
    profileSavePending: {current:false}, uncertainProfileSaves: {current:new Set()}, profileMounted: {current:true}, activeShopId: {current:'shop'}, setProfileSaveError: () => {}, selectedClient: original, addPointsClient: original, addPointsInFlight: {current:false}, accessToken: 'token', shop: { id: 'shop' }, notes: 'saved notes', birthday: '2000-01-01', hairProfile: {}, editField: 'email', fieldDraft: 'new@example.test', pointsToAdd: '5',
    // addPoints now routes through the hardened /api/loyalty/points door (server
    // does the balance math + returns the confirmed total) instead of a direct
    // client-side read-modify-write, so the mock returns the post-add balance.
    fetch: async (_url, opts) => { const b = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ ok: true, loyalty_points: 10 + b.points }) }; },
    profileState: { current: { clientId: selection?.id, editField: currentField, fieldDraft: currentDraft } },
    ensureRealClient: async () => 'original', formatPhone: s => s, showToast: () => {}, loadClients: () => {},
    setSaving: () => {}, setSavingHair: () => {}, setSavingBirthday: () => {}, setSavingField: () => {}, setFieldDraft: () => {}, setAddPointsClient: () => {},
    setSelectedClient: fn => { state.selected = fn(state.selected); }, setClients: fn => { state.clients = fn(state.clients); }, setEditField: v => { state.field = v; },
    supabase: { from: table => { assert.equal(table, 'clients'); const q = { eq: () => q, select: () => q, maybeSingle: async () => ({ data: { id: 'original', loyalty_points: 10 }, error: null }), then: (yes, no) => Promise.resolve({ error: null }).then(yes, no), update(payload) { state.writes.push(payload); state.selected = selection; return q; } }; return q; } },
  };
  return { state, handlers: new Function(...Object.keys(env), `${handlers}; return { saveNotes, saveHairProfile, saveBirthday, saveContactField, addPoints };`)(...Object.values(env)) };
}
(async () => {
  for (const name of ['saveNotes', 'saveHairProfile', 'saveBirthday', 'saveContactField', 'addPoints']) {
    for (const selection of [null, { id: 'other', notes: 'other notes', loyalty_points: 80 }]) {
      const p = setup(selection); await p.handlers[name](); assert.deepEqual(p.state.selected, selection, `${name} must not replace another open client`);
      if (name === 'saveContactField') assert.equal(p.state.field, 'email', 'Old save must not close another client editor');
    }
    const current = setup({ id: 'original', loyalty_points: 10 }); await current.handlers[name](); assert.equal(current.state.selected.id, 'original');
    if (name === 'saveNotes') assert.equal(current.state.selected.notes, 'saved notes');
    if (name === 'saveBirthday') assert.equal(current.state.selected.birthday, '2000-01-01');
    if (name === 'saveContactField') { assert.equal(current.state.selected.email, 'new@example.test'); assert.equal(current.state.field, null); }
    if (name === 'addPoints') assert.equal(current.state.selected.loyalty_points, 15);
  }
  for (const [field, draft] of [['phone', '555'], ['email', 'newer@example.test']]) {
    const changed = setup({ id: 'original' }, field, draft); await changed.handlers.saveContactField(); assert.equal(changed.state.field, field, 'A newer edit must remain open');
  }
  console.log('PASS client save UI targeting: late notes/hair/birthday/contact/points never replace another profile, same-client updates preserved, newer contact drafts remain open');
})().catch(error => { console.error(error); process.exitCode = 1; });
