const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
let role, foreign, count, existingAccount, mailMode, generated, sends, inserted;
function reset() { role = 'shop_owner'; foreign = false; count = 0; existingAccount = false; mailMode = ''; generated = []; sends = []; inserted = []; }
const inviteLink = 'https://auth.example.invalid/invite?token=fixture';
const barber = { id: 'barber', name: 'Saved barber', email: 'barber@example.invalid', shop_id: 'shop', user_id: null };
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: 'owner', email: 'owner@example.invalid' } : null } }), admin: {
    generateLink: async args => { generated.push(args); return { data: { properties: { action_link: inviteLink } }, error: existingAccount ? { message: 'already registered' } : null }; },
  } },
  from(table) {
    let many = false, emailLookup = false, counting = false, insert;
    const q = { select(fields, options) { counting = !!options?.head; return q; }, eq() { return q; }, ilike() { emailLookup = true; return q; }, order() { return q; }, limit() { many = true; return q; }, single() { return q; }, maybeSingle() { return q; }, insert(row) { insert = row; inserted.push(row); return q; }, then(resolve, reject) {
      const shop = { id: 'shop', name: 'Saved shop', email: 'shop@example.invalid', owner_id: foreign ? 'other' : 'owner', subscription_plan: 'fixture', subscription_status: 'active' };
      const data = table === 'users' ? (emailLookup ? null : { role }) : table === 'shops' ? (many ? (foreign ? [] : [shop]) : shop) : insert ? { ...barber, ...insert } : emailLookup || counting ? null : barber;
      return Promise.resolve({ data, error: null, count: counting ? count : null }).then(resolve, reject);
    } }; return q;
  },
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/validation': { effectivePlan: () => 'fixture', getPlanLimit: () => 3 },
  '@/lib/plans-server': { ensurePlansHydrated: async () => {} },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (mailMode === 'throw') throw Error('offline'); return mailMode === 'error' ? { error: 'rejected' } : { success: true }; } },
};
function load(route) {
  const file = path.join(root, `src/app/api/admin/barber/${route}/route.ts`), m = new Module(file, module); m.require = id => mocks[id] ?? appReq(id);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports.POST;
}
const invite = load('invite'), resend = load('resend-invite');
const request = (body = {}, token = 'valid') => new NextRequest('https://clipwise.ca/api/test', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.invalid' }, body: JSON.stringify({ name: 'Barber', email: ' BARBER@example.invalid ', barber_id: 'barber', commission_percent: 65, ...body }) });
global.fetch = async () => { throw Error('Unexpected HTTP email hop'); };
(async () => {
  for (const handler of [invite, resend]) {
    for (const base of [undefined, 'https://configured.example.invalid///']) {
      if (base) process.env.NEXT_PUBLIC_APP_URL = base; else delete process.env.NEXT_PUBLIC_APP_URL;
      const expected = base ? 'https://configured.example.invalid' : 'https://clipwise.ca';
      for (const registered of [false, true]) {
        reset(); existingAccount = registered;
        const response = await handler(request()), body = await response.json();
        assert.equal(response.status, 200); assert.equal(body.emailed, true); assert.equal(body.existingAccount, registered);
        assert.equal(generated[0].type, 'invite'); assert.equal(generated[0].email, barber.email);
        assert.equal(generated[0].options.redirectTo, `${expected}/accept-invite`);
        assert.deepEqual(generated[0].options.data, { invite_barber_id: 'barber', role: 'barber' });
        assert.equal(sends.length, 1); assert.equal(sends[0].type, 'barber_invite'); assert.equal(sends[0].data.barberEmail, barber.email);
        assert.equal(sends[0].data.inviteLink, registered ? `${expected}/login` : inviteLink);
        assert.equal(body.inviteLink, registered ? null : inviteLink);
        if (handler === invite) assert.equal(inserted[0].commission_percent, 65);
      }
    }
    for (const mode of ['error', 'throw']) { reset(); mailMode = mode; const body = await (await handler(request())).json(); assert.equal(body.ok, true); assert.equal(body.emailed, false); assert.ok(body.emailError); }
    for (const mode of ['auth', 'role', 'foreign']) {
      reset(); role = mode === 'role' ? 'barber' : role; foreign = mode === 'foreign';
      assert.equal((await handler(request({}, mode === 'auth' ? 'bad' : 'valid'))).status, mode === 'auth' ? 401 : mode === 'foreign' && handler === invite ? 404 : 403);
      assert.equal(sends.length, 0); assert.equal(generated.length, 0);
    }
  }
  for (const body of [{ skip_invite: true }, { email: 'owner@example.invalid' }]) { reset(); const result = await (await invite(request(body))).json(); assert.equal(result.ok, true); assert.equal(sends.length, 0); assert.equal(generated.length, 0); assert.equal(body.skip_invite ? result.manual : result.ownerSelf, true); }
  reset(); count = 3; const response = await invite(request()); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'barber_limit'); assert.equal(inserted.length, 0); assert.equal(generated.length, 0);
  console.log('PASS invitations: trusted redirect/login destinations, canonical recipients, internal sends, manual/self-add/permissions/plan limit/delivery failures preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
