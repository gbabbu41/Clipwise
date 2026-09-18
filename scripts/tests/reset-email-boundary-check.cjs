const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
let actor, role, owner, loginEmail, generated, sends, hops, mailMode, linkError, throttle;
function reset() { actor = 'owner'; role = 'shop_owner'; owner = 'owner'; loginEmail = 'login@example.invalid'; generated = []; sends = []; hops = []; mailMode = ''; linkError = false; throttle = false; }
const secretLink = 'https://auth.example.invalid/recovery?token=fixture-secret';
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: actor } : null }, error: null }), admin: {
    getUserById: async () => ({ data: { user: { email: loginEmail } } }),
    generateLink: async args => { generated.push(args); return { data: { properties: { action_link: secretLink } }, error: linkError ? { message: 'missing account' } : null }; },
  } },
  from(table) { const q = { select() { return q; }, eq() { return q; }, single() { return q; }, maybeSingle() { return q; }, then(resolve, reject) {
    const rows = { users: { role }, shops: { owner_id: owner, name: 'Saved shop', email: 'shop@example.invalid' }, barbers: { user_id: 'barber-user', name: 'Saved barber', email: 'different-contact@example.invalid', shop_id: 'shop' } };
    return Promise.resolve({ data: rows[table], error: null }).then(resolve, reject);
  } }; return q; },
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/rate-limit': { enforceRateLimit: () => null, rateLimit: () => ({ ok: !throttle }) },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (mailMode === 'throw') throw Error('offline'); return mailMode === 'error' ? { error: 'rejected' } : { success: true }; } },
};
function load(route, source) {
  const file = path.join(root, `src/app/api/${route}/route.ts`), m = new Module(file, module); m.require = id => mocks[id] ?? appReq(id);
  m._compile(ts.transpileModule(source ?? fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports.POST;
}
const admin = load('admin/barber/reset-password'), forgot = load('auth/forgot-password');
global.fetch = async (...args) => { hops.push(args); return new Response('{}'); };
const request = (body, token = 'valid') => new NextRequest('https://clipwise.ca/api/test', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.invalid' }, body: JSON.stringify(body) });
(async () => {
  process.env.CRON_SECRET = 'fixture-cron';
  for (const base of [undefined, 'https://configured.example.invalid/']) {
    if (base) process.env.NEXT_PUBLIC_APP_URL = base; else delete process.env.NEXT_PUBLIC_APP_URL;
    const expected = base ? 'https://configured.example.invalid' : 'https://clipwise.ca';
    reset(); const response = await admin(request({ barber_id: 'barber', email: 'attacker@example.invalid' })); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.emailed, true); assert.equal(hops.length, 0); assert.equal(generated[0].options.redirectTo, `${expected}/barber-dashboard`); assert.equal(sends[0].data.barberEmail, loginEmail); assert.equal(sends[0].data.resetLink, secretLink); assert.doesNotMatch(JSON.stringify(body), /fixture-secret|fixture-cron/);
    reset(); assert.deepEqual(await (await forgot(request({ email: ' CLIENT@example.invalid ' }))).json(), { ok: true }); assert.equal(generated[0].options.redirectTo, `${expected}/reset-password`); assert.equal(sends[0].data.email, 'client@example.invalid'); assert.equal(hops.length, 0);
  }
  for (const mode of ['error', 'throw']) { reset(); mailMode = mode; assert.equal((await (await admin(request({ barber_id: 'barber' }))).json()).emailed, false); assert.deepEqual(await (await forgot(request({ email: 'client@example.invalid' }))).json(), { ok: true }); }
  for (const mode of ['auth', 'role', 'foreign', 'no-email']) {
    reset(); if (mode === 'role') role = 'barber'; if (mode === 'foreign') owner = 'other'; if (mode === 'no-email') loginEmail = null;
    assert.equal((await admin(request({ barber_id: 'barber' }, mode === 'auth' ? 'bad' : 'valid'))).status, { auth: 401, role: 403, foreign: 403, 'no-email': 400 }[mode]); assert.equal(generated.length, 0); assert.equal(sends.length, 0);
  }
  reset(); role = 'super_admin'; owner = 'other'; assert.equal((await admin(request({ barber_id: 'barber' }))).status, 200);
  for (const mode of ['missing-account', 'throttle']) { reset(); linkError = mode === 'missing-account'; throttle = mode === 'throttle'; assert.deepEqual(await (await forgot(request({ email: 'client@example.invalid' }))).json(), { ok: true }); assert.equal(sends.length, 0); }
  console.log('PASS recovery email: internal delivery, trusted redirects, canonical login recipient, no response token, existing owner/admin/privacy/failure gates preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
