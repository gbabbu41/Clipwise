const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function handler(file, start, end, env, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  const code = ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), `${code}; return ${name};`)(...Object.values(env));
}
function setup(data, ok = true) {
  const state = { sent: false, open: true, reloads: 0, requests: 0, toasts: [], added: [], ids: [], error: '' };
  const env = {
    shop: { id: 'shop', subscription_plan: 'fixture' }, addForm: { name: 'Barber', email: 'barber@example.invalid', commission_percent: '65' }, barbers: [], accessToken: 'fixture-token',
    getPlanLimit: () => 3, validateEmail: () => null, barberLimitMsg: () => 'limit',
    fetch: async () => { state.requests++; return { ok, json: async () => data }; },
    showToast: value => state.toasts.push(value), setSavingAdd: () => {}, setShowAddModal: value => { state.open = value; }, setAddForm: () => {},
    setInviteSent: value => { state.sent = value; }, setInviteLinkModal: value => { state.link = value; }, loadBarbers: () => { state.reloads++; },
    createdShopId: 'shop', addedBarbers: [], planLimit: 3, setAddingBarber: () => {}, setBarberError: value => { state.error = value; },
    setAddedBarbers: fn => { state.added = fn(state.added); }, setCreatedBarberIds: fn => { state.ids = fn(state.ids); }, setShowAddOther: () => {}, setOtherBarber: () => {}, setBlockHint: () => {},
  };
  return { state, staff: handler('src/app/dashboard/staff/page.tsx', '  const submitNewBarber =', '  // Both tabs', env, 'submitNewBarber'), onboarding: handler('src/app/onboarding/page.tsx', '  const inviteBarber =', '  const addSelfAsBarber =', env, 'inviteBarber') };
}
(async () => {
  const pending = { ok: true, barber: { id: 'saved' }, invitePending: true, emailed: false, existingAccount: false, inviteLink: null };
  const p = setup(pending); await p.staff(false); assert.equal(p.state.sent, false); assert.equal(p.state.open, false); assert.equal(p.state.reloads, 1); assert.equal(p.state.requests, 1); assert.match(p.state.toasts[0], /Barber added.*Resend invite/);
  for (const data of [pending, { ok: true, barber: { id: 'saved' }, emailed: false, inviteLink: 'https://auth.example.invalid/invite' }, { ok: true, barber: { id: 'saved' }, emailed: false, existingAccount: true }]) {
    const onboard = setup(data); await onboard.onboarding('Barber', 'barber@example.invalid', 65); assert.deepEqual(onboard.state.ids, ['saved']); assert.equal(onboard.state.added.length, 1); assert.match(onboard.state.error, /Barber added.*Resend invite.*Don't add them again/);
    const staff = setup(data); await staff.staff(false); assert.equal(staff.state.sent, false); assert.equal(staff.state.open, false); assert.equal(staff.state.reloads, 1);
    if (data.inviteLink) assert.equal(staff.state.link.emailed, false);
  }
  for (const data of [{ ok: true, barber: { id: 'saved' }, ownerSelf: true }, { ok: true, barber: { id: 'saved' }, emailed: true, inviteLink: 'https://auth.example.invalid/invite' }]) {
    const p = setup(data); await p.onboarding('Barber', 'barber@example.invalid', 65); assert.equal(p.state.error, ''); assert.deepEqual(p.state.ids, ['saved']);
    await p.staff(false); assert.equal(p.state.sent, !data.ownerSelf); assert.equal(p.state.reloads, 1);
  }
  const rejected = setup({ error: 'unavailable' }, false); await rejected.staff(false); await rejected.onboarding('Barber', 'barber@example.invalid', 65); assert.equal(rejected.state.reloads, 0); assert.equal(rejected.state.added.length, 0); assert.equal(rejected.state.sent, false);
  console.log('PASS invitation feedback: saved staff retained, no false sent screen after failure, resend guidance, onboarding saved IDs and self/success/rejection paths preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
