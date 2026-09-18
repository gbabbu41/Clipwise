const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
const emailSource = fs.readFileSync(path.join(root, 'src/lib/emailer.ts'), 'utf8');
const serverOnlyDeclaration = emailSource.match(/export const SERVER_ONLY_EMAIL_TYPES = new Set\(\[[\s\S]*?\]\);/)[0];
const serverOnlyTypes = new Function(`${serverOnlyDeclaration.replace('export ', '')}; return SERVER_ONLY_EMAIL_TYPES;`)();
const privilegedDeclaration = emailSource.match(/export const PRIVILEGED_EMAIL_TYPES = new Set\(\[[\s\S]*?\]\);/)[0];
const privilegedTypes = new Function(`${privilegedDeclaration.replace('export ', '')}; return PRIVILEGED_EMAIL_TYPES;`)();
let actor, source, failed, queries, sends, storedEmail;
function reset() { actor = 'owner'; source = 'clients'; failed = ''; queries = []; sends = []; storedEmail = 'Client@example.invalid'; }
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: actor } : null } }) },
  from(table) {
    const filters = [];
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, ilike(k, v) { filters.push([k, v]); return q; }, limit() { return q; }, maybeSingle() { return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        queries.push({ table, filters });
        if (table === failed) return { data: null, error: { message: 'private failure' } };
        if (table === 'shops') return { data: { id: filters.find(([k]) => k === 'id')[1], owner_id: 'owner', name: 'Saved shop', slug: 'saved-shop', email: 'shop@example.invalid' }, error: null };
        if (table === 'users') return { data: { role: actor === 'owner' ? 'shop_owner' : 'barber' }, error: null };
        assert.ok(filters.some(([k, v]) => k === 'shop_id' && v === 'shop'), 'recipient read must be scoped');
        if (table === 'barbers') { assert.ok(filters.some(([k,v]) => k === 'is_active' && v === true)); return { data: actor === 'active-barber' ? { id: 'barber', permissions: {} } : null, error: null }; }
        return { data: table === source ? [table === 'clients' ? { name: 'Saved client', email: storedEmail } : { client_name: 'Saved client', client_email: storedEmail }] : [], error: null };
      }).then(resolve, reject); },
    }; return q;
  },
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, './supabase-admin': { supabaseAdmin: db },
  '@/lib/emailer': { PRIVILEGED_EMAIL_TYPES: privilegedTypes, SERVER_ONLY_EMAIL_TYPES: serverOnlyTypes, sendAppEmail: async (type, data) => { sends.push({ type, data }); return { success: true }; } },
  '@/lib/validation': {}, '@/lib/plans-server': {}, '@/lib/rate-limit': { enforceRateLimit: () => null },
};
function load(relative) {
  const file = path.join(root, relative), m = new Module(file, module);
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id));
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports;
}
const { POST } = load('src/app/api/send-email/route.ts');
const payload = { type: 'birthday_wish', data: { shopId: 'shop', clientEmail: 'client@example.invalid', shopName: 'Forged', shopEmail: 'attacker@example.invalid', shopSlug: 'forged', clientName: 'Forged' } };
const call = (body = payload, token = 'valid', internal = true) => POST(new NextRequest('https://clipwise.ca/api/send-email', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(internal ? { 'x-internal-secret': 'dummy-cron' } : {}) }, body: JSON.stringify(body) }));
(async () => {
  process.env.RESEND_API_KEY = 'dummy'; process.env.CRON_SECRET = 'dummy-cron';
  const direct = { type: 'direct_message', data: { ...payload.data, content: 'Your chosen message\nkeeps its content.' } };
  for (const internal of [false, true]) {
    for (const token of ['', 'expired']) { reset(); assert.equal((await call(direct, token, internal)).status, 401); assert.equal(sends.length, 0); }
    for (const who of ['foreign-owner', 'barber', 'customer']) { reset(); actor = who; assert.equal((await call(direct, 'valid', internal)).status, 403); assert.equal(sends.length, 0); }
    for (const who of ['owner', 'active-barber']) for (const table of ['clients', 'appointments', 'transactions']) {
      reset(); actor = who; source = table; assert.equal((await call(direct, 'valid', internal)).status, 200);
      assert.deepEqual(sends[0], { type: 'direct_message', data: { clientName: 'Saved client', clientEmail: storedEmail, shopName: 'Saved shop', shopEmail: 'shop@example.invalid', shopSlug: 'saved-shop', content: direct.data.content } });
    }
  }
  for (const table of ['clients', 'appointments', 'transactions']) { reset(); source = 'transactions'; failed = table; assert.equal((await call(direct)).status, 503); assert.equal(sends.length, 0); }
  reset(); source = ''; assert.equal((await call(direct)).status, 404); assert.equal(sends.length, 0);
  reset(); storedEmail = 'other@example.invalid'; assert.equal((await call(direct)).status, 404); assert.equal(sends.length, 0);
  for (const data of [{ ...direct.data, shopId: undefined }, { ...direct.data, content: '' }, { ...direct.data, content: [] }, { ...direct.data, clientEmail: 'a@example.invalid,b@example.invalid' }]) { reset(); assert.equal((await call({ type: 'direct_message', data })).status, 400); assert.equal(sends.length, 0); }
  const messagePage = fs.readFileSync(path.join(root, 'src/app/dashboard/messages/page.tsx'), 'utf8');
  assert.equal((messagePage.match(/type: "direct_message",\s+data: \{\s+shopId: shop.id/g) || []).length, 2);
  console.log('PASS direct email: tenant and saved-recipient authorization, active staff, no shared-secret bypass, canonical branding, preserved text, failed reads and both caller shop IDs');
  for (const token of ['', 'expired']) { reset(); assert.equal((await call(payload, token)).status, 401); assert.equal(sends.length, 0); assert.equal(queries.length, 0); }
  for (const who of ['foreign-owner', 'barber', 'customer']) { reset(); actor = who; assert.equal((await call()).status, 403); assert.equal(sends.length, 0); assert.equal(queries.length, 1); }
  for (const table of ['clients', 'appointments', 'transactions']) {
    reset(); source = table; assert.equal((await call()).status, 200);
    assert.deepEqual(sends, [{ type: 'birthday_wish', data: { clientName: 'Saved client', clientEmail: storedEmail, shopName: 'Saved shop', shopEmail: 'shop@example.invalid', shopSlug: 'saved-shop' } }]);
  }
  reset(); source = ''; assert.equal((await call()).status, 404); assert.equal(sends.length, 0);
  for (const table of ['clients', 'appointments', 'transactions']) { reset(); source = 'transactions'; failed = table; const r = await call(); assert.equal(r.status, 503); assert.doesNotMatch(await r.text(), /private failure/); assert.equal(sends.length, 0); }
  reset(); storedEmail = 'someone-else@example.invalid'; assert.equal((await call()).status, 404); assert.equal(sends.length, 0);
  for (const data of [null, {}, { shopId: 'shop', clientEmail: ['a@example.invalid'] }, { shopId: 'shop', clientEmail: 'a@example.invalid,b@example.invalid' }]) { reset(); assert.equal((await call({ type: 'birthday_wish', data })).status, 400); assert.equal(sends.length, 0); }
  reset(); storedEmail = 'a_b%test@example.invalid'; assert.equal((await call({ type: 'birthday_wish', data: { shopId: 'shop', clientEmail: storedEmail } })).status, 200);
  assert.ok(queries.some(q => q.filters.some(([k, v]) => k === 'email' && v === 'a\\_b\\%test@example.invalid')));
  reset(); assert.equal((await call({ type: 'subscription_started', data: {} })).status, 403); assert.equal(sends.length, 0);
  for (const type of ['signup_code', 'subscription_card_updated', 'owner_weekly_digest', 'connect_reminder', 'password_reset', 'barber_password_reset', 'barber_invite', 'payment_link']) {
    for (const token of ['', 'valid']) {
      reset(); assert.equal((await call({ type, data: { email: 'target@example.invalid', code: '111111' } }, token)).status, 403, `${type} must reject HTTP sends, including shared-secret callers`);
      assert.equal(sends.length, 0); assert.equal(queries.length, 0);
    }
  }
  const page = fs.readFileSync(path.join(root, 'src/app/dashboard/clients/page.tsx'), 'utf8');
  const handler = page.slice(page.indexOf('  const sendBirthdayEmail ='), page.indexOf('  const addPoints ='));
  assert.match(handler, /Authorization: `Bearer \$\{accessToken\}`/); assert.match(handler, /shopId: shop.id/);
  assert.match(handler, /birthdaySendInFlight.current = true/); assert.match(handler, /finally/); assert.doesNotMatch(handler, /shopName:/);
  let requests = [], busy = [], messages = [], release;
  const inFlight = { current: false };
  const makeHandler = (token, fetcher) => new Function('selectedClient', 'shop', 'accessToken', 'activeShopId', 'birthdaySendInFlight', 'setSendingBirthday', 'showToast', 'fetch', `${handler}; return sendBirthdayEmail;`)(
    { email: 'client@example.invalid', shop_id: 'shop' }, { id: 'shop' }, token, { current: 'shop' }, inFlight,
    value => busy.push(value), value => messages.push(value), fetcher);
  const send = makeHandler('valid', async (url, init) => { requests.push({ url, init }); await new Promise(resolve => { release = resolve; }); return { ok: true }; });
  const pending = send(); await send(); assert.equal(requests.length, 1); assert.equal(inFlight.current, true);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer valid'); assert.deepEqual(JSON.parse(requests[0].init.body), { type: 'birthday_wish', data: { shopId: 'shop', clientEmail: 'client@example.invalid' } });
  release(); await pending; assert.deepEqual(busy, [true, false]); assert.equal(inFlight.current, false);
  await makeHandler('valid', async () => { throw Error('offline'); })(); assert.equal(inFlight.current, false); assert.match(messages.at(-1), /Could not confirm/);
  await makeHandler('', async () => { throw Error('must not fetch'); })(); assert.match(messages.at(-1), /sign in/);
  const cron = fs.readFileSync(path.join(root, 'src/app/api/cron/reminders/route.ts'), 'utf8');
  assert.match(cron, /sendAppEmail\(/); assert.match(cron, /sendEmail\("birthday_wish"/); assert.doesNotMatch(cron, /\/api\/send-email/);
  for (const type of ['owner_weekly_digest', 'connect_reminder']) assert.ok(cron.includes(`sendEmail("${type}"`));
  for (const [file, type] of [['src/app/api/auth/request-code/route.ts', 'signup_code'], ['src/app/api/stripe/notify-card-updated/route.ts', 'subscription_card_updated']]) {
    const caller = fs.readFileSync(path.join(root, file), 'utf8'); assert.ok(caller.includes(`sendAppEmail("${type}"`)); assert.doesNotMatch(caller, /\/api\/send-email/);
  }
  console.log('PASS birthday email: owner/token gate, scoped saved/booking/POS recipients, canonical branding, failed reads, wildcard exact check, caller and cron wiring');
})().catch(error => { console.error(error); process.exitCode = 1; });
