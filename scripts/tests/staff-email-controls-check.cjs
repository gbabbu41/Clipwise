const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app/dashboard/staff/page.tsx'), 'utf8');
const from = source.indexOf('  const resetPassword ='), to = source.indexOf('  // ── Remove barber', from);
assert.ok(from > 0 && to > from);
const code = ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(mode = 'success') {
  const state = { requests: [], toasts: [], reset: null, resend: null, modal: null, link: null };
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const env = {
    accessToken: 'fixture', staffEmailPending: { current: false }, staffEmailContext: { current: 1 },
    setResettingId: v => { state.reset = v; }, setResendingInviteId: v => { state.resend = v; },
    setResetModal: v => { state.modal = v; }, setInviteLinkModal: v => { state.link = v; }, showToast: v => state.toasts.push(v),
    fetch: async (url, args) => {
      state.requests.push({ url, args }); if (mode === 'held') await held; if (mode === 'offline') throw Error('network');
      return { ok: mode !== 'reject', json: async () => {
        if (mode === 'json') throw Error('invalid JSON'); if (mode === 'malformed') return {};
        if (mode === 'reject') return { error: 'Try later' };
        return { ok: true, email: 'login@example.invalid', name: 'Saved name', emailed: mode !== 'unsent', existingAccount: false, inviteLink: 'https://auth.example.invalid/invite' };
      } };
    },
  };
  return { state, env, release, ...new Function(...Object.keys(env), `${code}; return {resetPassword, resendInvite};`)(...Object.values(env)) };
}
const barber = { id: 'barber', name: 'Barber', email: 'barber@example.invalid' };
(async () => {
  for (const action of ['resetPassword', 'resendInvite']) {
    for (const mode of ['offline', 'json', 'malformed', 'reject', 'unsent', 'success']) {
      const p = setup(mode); await p[action](barber); assert.equal(p.env.staffEmailPending.current, false); assert.equal(p.state.reset, null); assert.equal(p.state.resend, null); assert.equal(p.state.requests.length, 1);
      assert.deepEqual(JSON.parse(p.state.requests[0].args.body), { barber_id: barber.id }); assert.equal(p.state.requests[0].args.headers.Authorization, 'Bearer fixture');
      if (['offline', 'json', 'malformed'].includes(mode)) { assert.match(p.state.toasts[0], /Couldn't confirm.*inbox/); assert.equal(p.state.modal, null); assert.equal(p.state.link, null); }
      if (mode === 'reject') assert.equal(p.state.toasts[0], 'Error: Try later');
      if (['unsent', 'success'].includes(mode)) assert.equal((action === 'resetPassword' ? p.state.modal : p.state.link).emailed, mode === 'success');
      await p[action](barber); assert.equal(p.state.requests.length, 2, 'explicit later request allowed after cleanup');
    }
    const p = setup('held'), first = p[action](barber); await p.resetPassword(barber); await p.resendInvite({ ...barber, id: 'other' }); assert.equal(p.state.requests.length, 1); p.release(); await first;
    const stale = setup('held'), pending = stale[action](barber); stale.env.staffEmailContext.current++; stale.release(); await pending; assert.equal(stale.state.modal, null); assert.equal(stale.state.link, null); assert.equal(stale.state.toasts.length, 0); assert.equal(stale.env.staffEmailPending.current, false);
    const missing = setup(); missing.env.accessToken = ''; // Bind a fresh handler with no session.
    const fn = new Function(...Object.keys(missing.env), `${code}; return ${action};`)(...Object.values(missing.env)); await fn(barber); assert.equal(missing.state.requests.length, 0);
  }
  assert.match(source, /return \(\) => \{ staffEmailContext.current = context \+ 1; \}/);
  assert.equal((source.match(/disabled=\{resettingId !== null \|\| resendingInviteId !== null\}/g) || []).length, 2);
  console.log('PASS staff email controls: pending duplicate/cross-action guard, failed fetch/JSON/malformed recovery, explicit retry, payload/token preservation, delivery feedback and stale-context suppression');
})().catch(error => { console.error(error); process.exitCode = 1; });
