const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/staff/page.tsx'), 'utf8');
const start = source.indexOf('  const submitNewBarber ='), end = source.indexOf('  // ── Password reset', start);
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(mode = 'success') {
  let release; const held = new Promise(resolve => { release = resolve; });
  const state = { requests: [], saving: false, error: '', clears: 0, reloads: 0, toasts: [] };
  const env = {
    shop: { id: 'shop', subscription_plan: 'fixture' }, accessToken: 'fixture', user: { email: 'owner@example.invalid' }, profile: { name: 'Owner' }, barbers: [],
    addForm: { name: 'Barber', email: 'barber@example.invalid', commission_percent: '65' }, getPlanLimit: () => 3, barberLimitMsg: () => 'limit', validateEmail: () => null,
    staffCreateState: { current: 'idle' }, staffEmailContext: { current: 1 }, setStaffCreateError: v => { state.error = v; }, setSavingAdd: v => { state.saving = v; },
    showToast: v => state.toasts.push(v), setAddForm: () => { state.clears++; }, setShowAddModal: () => {}, setInviteSent: () => {}, setInviteLinkModal: () => {}, loadBarbers: () => { state.reloads++; },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); state.requests.push({ url, options, body });
      if (mode === 'held') await held; if (mode === 'offline') throw Error('offline');
      return { ok: !['reject', 'server'].includes(mode), status: mode === 'reject' ? 409 : mode === 'server' ? 503 : 200, json: async () => {
        if (mode === 'json') throw Error('invalid'); if (mode === 'malformed') return { ok: true }; if (['reject', 'server'].includes(mode)) return { error: 'unavailable' };
        return { ok: true, barber: { id: 'saved' }, ownerSelf: body.email === 'owner@example.invalid', manual: body.skip_invite, emailed: true, inviteLink: 'https://auth.example.invalid/invite' };
      } };
    },
  };
  return { state, env, release, ...new Function(...Object.keys(env), `${code}; return {inviteBarber, addBarber, addSelfAsBarber};`)(...Object.values(env)) };
}
(async () => {
  for (const action of ['inviteBarber', 'addBarber', 'addSelfAsBarber']) {
    for (const mode of ['offline', 'json', 'malformed', 'server']) {
      const p = setup(mode); await p[action](); assert.equal(p.state.saving, false); assert.equal(p.env.staffCreateState.current, 'uncertain'); assert.match(p.state.error, /Refresh and check the team/); assert.equal(p.state.clears, 0); assert.equal(p.state.reloads, 0);
      await p.inviteBarber(); await p.addBarber(); await p.addSelfAsBarber(); assert.equal(p.state.requests.length, 1);
    }
    const rejected = setup('reject'); await rejected[action](); assert.equal(rejected.env.staffCreateState.current, 'idle'); assert.equal(rejected.state.clears, 0); await rejected[action](); assert.equal(rejected.state.requests.length, 2);
    const held = setup('held'), pending = held[action](); await held.inviteBarber(); await held.addBarber(); await held.addSelfAsBarber(); assert.equal(held.state.requests.length, 1); held.release(); await pending; assert.equal(held.state.saving, false); assert.equal(held.state.reloads, 1);
    const payload = held.state.requests[0].body; assert.equal(payload.shop_id, 'shop'); assert.equal(payload.commission_percent, action === 'addSelfAsBarber' ? 0 : 65); assert.equal(held.state.requests[0].options.headers.Authorization, 'Bearer fixture');
    const stale = setup('held'), old = stale[action](); stale.env.staffEmailContext.current++; stale.release(); await old; assert.equal(stale.state.reloads, 0); assert.equal(stale.state.clears, 0); assert.equal(stale.state.toasts.length, 0);
  }
  assert.match(source, /value=\{addForm\[key\]\}\s+disabled=\{savingAdd\}/);
  assert.match(source, /role="alert"[^\n]+staffCreateError/);
  console.log('PASS staff creation controls: cross-entry duplicate guard, retained rejected drafts, uncertain network/server/malformed lock, cleared busy state, stale context and unchanged payloads');
})().catch(error => { console.error(error); process.exitCode = 1; });
