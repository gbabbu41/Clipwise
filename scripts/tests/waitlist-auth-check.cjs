const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
const shopId = '11111111-1111-4111-8111-111111111111', otherShop = '22222222-2222-4222-8222-222222222222';
const barberId = '33333333-3333-4333-8333-333333333333', appointmentId = '44444444-4444-4444-8444-444444444444';
let actor, active, permission, sends, writes, queries, failures, appointment, limited, waiters;
function reset() {
  actor = 'owner'; active = true; permission = true; sends = []; writes = []; queries = []; failures = new Set(); limited = null;
  appointment = { shop_id: shopId, date: '2030-10-01', barber_id: barberId };
  waiters = [{ id: 'waiter', client_name: 'Fixture', client_email: 'fixture@example.invalid', client_phone: '+15555550100', barber_id: null }];
}
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' && actor ? { id: actor } : null }, error: null }) },
  from(table) {
    let filters = [], values, many = false;
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, maybeSingle() { return q; },
      in(k, v) { many = true; filters.push([k, v]); return q; }, or(v) { filters.push(['or', v]); return q; }, update(v) { values = v; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        queries.push({ table, filters });
        if (failures.has(table)) return { data: null, error: { message: 'private detail' } };
        if (values) { writes.push({ table, values, filters }); return { data: null, error: null }; }
        const match = key => filters.find(([k]) => k === key)?.[1];
        let data = null;
        if (table === 'shops') data = { id: match('id'), owner_id: match('id') === shopId ? 'owner' : 'foreign', name: 'Fixture', slug: 'fixture', email: '' };
        if (table === 'appointments') data = appointment;
        if (table === 'barbers') data = many ? [] : match('user_id') ? (actor === 'staff' && active && match('shop_id') === shopId ? { id: barberId, permissions: { manage_appointments: permission } } : null) : (match('id') === barberId && match('shop_id') === shopId ? { id: barberId } : null);
        if (table === 'appointment_waitlist') data = waiters;
        return { data, error: null };
      }).then(resolve, reject); },
    }; return q;
  },
};
const mocks = {
  'server-only': {}, '@/lib/supabase-admin': { supabaseAdmin: db }, './supabase-admin': { supabaseAdmin: db },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); return { success: true }; } },
  '@/lib/twilio': { sendSmsBestEffort: async (phone, text) => { sends.push({ phone, text }); } },
  '@/lib/rate-limit': { enforceRateLimit: () => limited },
};
const cache = {};
function load(relative) {
  if (cache[relative]) return cache[relative];
  const filename = path.join(root, relative), m = new Module(filename, module); m.filename = filename;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id));
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return cache[relative] = m.exports;
}
const route = load('src/app/api/waitlist/slot-opened/route.ts');
const body = { shop_id: shopId, date: '2030-10-01' };
const call = (payload = body, token = 'valid') => route.POST(new NextRequest('https://clipwise.ca/api/waitlist/slot-opened', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: 'https://attacker.invalid' }, body: JSON.stringify(payload) }));
const noEffects = () => { assert.deepEqual(sends, []); assert.deepEqual(writes, []); assert.equal(queries.some(q => q.table === 'appointment_waitlist'), false); };
(async () => {
  reset(); assert.equal((await call(body, '')).status, 401); noEffects(); assert.equal(queries.length, 0);
  reset(); assert.equal((await call(body, 'invalid')).status, 401); noEffects();
  reset(); assert.equal((await call({ ...body, shop_id: otherShop })).status, 403); noEffects();
  for (const mode of ['inactive', 'unpermitted', 'foreign']) { reset(); actor = mode === 'foreign' ? 'outsider' : 'staff'; active = mode !== 'inactive'; permission = mode !== 'unpermitted'; assert.equal((await call()).status, 403); noEffects(); }
  for (const payload of [null, [], {}, { ...body, date: '2030-02-30' }, { ...body, barber_id: 'bad-filter)' }, { ...body, appointment_id: 'bad' }]) { reset(); assert.equal((await call(payload)).status, 400); noEffects(); }
  reset(); appointment = null; assert.equal((await call({ ...body, appointment_id: appointmentId })).status, 404); noEffects();
  reset(); appointment.shop_id = otherShop; assert.equal((await call({ ...body, appointment_id: appointmentId })).status, 403); noEffects();
  reset(); assert.equal((await call({ ...body, barber_id: otherShop })).status, 400); noEffects();
  for (const who of ['owner', 'staff']) {
    reset(); actor = who; delete process.env.NEXT_PUBLIC_APP_URL;
    const res = await call(); assert.equal(res.status, 200); assert.equal((await res.json()).notified, 1); assert.equal(sends.length, 2); assert.equal(writes.length, 1);
    assert.equal(sends[0].data.bookingUrl, 'https://clipwise.ca/book/fixture');
    const query = queries.find(q => q.table === 'appointment_waitlist'); assert.deepEqual(query.filters, [['shop_id', shopId], ['desired_date', body.date], ['status', 'waiting']]);
  }
  reset(); assert.equal((await call({ appointment_id: appointmentId, shop_id: otherShop, date: '2030-10-09' })).status, 200);
  assert.ok(queries.some(q => q.filters.some(([k, v]) => k === 'or' && v === `barber_id.is.null,barber_id.eq.${barberId}`)));
  reset(); failures.add('appointment_waitlist'); const res = await call(); assert.equal(res.status, 500); assert.doesNotMatch(await res.text(), /private detail/); assert.deepEqual(sends, []);
  reset(); failures.add('appointments'); assert.equal((await call({ appointment_id: appointmentId })).status, 503); noEffects();
  reset(); failures.add('shops'); assert.equal((await call()).status, 404); noEffects();
  reset(); limited = new Response('{}', { status: 429 }); assert.equal((await call()).status, 429); noEffects();
  reset(); waiters = []; assert.equal((await (await call()).json()).notified, 0); assert.deepEqual(sends, []);
  // Execute the shared browser caller to verify token forwarding.
  const effects = load('src/lib/appointment-actions.ts');
  let requests = []; global.fetch = async (url, init) => { requests.push({ url, init }); return new Response('{}'); };
  effects.notifyFreedSlot({ id: appointmentId, date: body.date, barber_id: barberId }, { id: shopId }, 'Cancelled', 'valid');
  assert.equal(requests.find(r => r.url.includes('slot-opened')).init.headers.Authorization, 'Bearer valid');
  // Wiring regression: no server callers rely on the newly protected HTTP route.
  for (const file of ['src/app/api/my-booking/[id]/route.ts', 'src/app/api/stripe/refund/route.ts', 'src/app/api/stripe/refund-payment/route.ts']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8'); assert.ok(source.includes('await notifyWaitlistForSlot(')); assert.equal(source.includes('/api/waitlist/slot-opened'), false);
  }
  console.log('PASS waitlist: no unauthenticated/cross-shop/unpermitted sends, staff/manual and appointment paths, input/read failures, trusted links, token forwarding and internal caller wiring');
})().catch(error => { console.error(error); process.exitCode = 1; });
