const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
let sends, hops, events, actor, conflict, insertError, email, sendMode, release;
function reset() { sends = []; hops = []; events = []; actor = 'owner'; conflict = false; insertError = false; email = 'client@example.invalid'; sendMode = ''; release = null; }
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: actor } : null } }) },
  from(table) {
    let values, insert = false;
    const q = {
      select() { return q; }, eq() { return q; }, maybeSingle() { return q; }, single() { return q; },
      insert(v) { values = v; insert = true; return q; }, update(v) { values = v; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (values) {
          events.push([table, insert ? 'insert' : 'update']);
          if (insert && insertError) return { data: null, error: { message: 'failed' } };
          return { data: insert ? { id: 'appointment-saved' } : null, error: null };
        }
        const rows = {
          appointment_waitlist: { id: 'waiter', shop_id: 'shop', service_id: null, client_name: 'Saved client', client_email: email, client_phone: '', desired_date: '2030-09-18', status: 'waiting' },
          shops: { id: 'shop', owner_id: 'owner', name: 'Saved shop', slug: 'saved-shop', email: 'shop@example.invalid', timezone: 'America/Halifax' },
          barbers: actor === 'barber' ? { id: 'staff' } : null,
        };
        return { data: rows[table], error: null };
      }).then(resolve, reject); },
    }; return q;
  },
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/booking-conflict': { barberHasConflict: async () => conflict, isDoubleBookError: () => false },
  '@/lib/utils': { timeToMinutes: () => 600 }, '@/lib/timezone': { isBookingInPast: () => false },
  '@/lib/ensure-client': { ensureClientRow: async () => null },
  '@/lib/emailer': { sendAppEmail: async (type, data) => {
    sends.push({ type, data }); events.push(['email', 'send']);
    if (sendMode === 'throw') throw Error('provider failure');
    if (sendMode === 'wait') await new Promise(resolve => { release = resolve; });
    return sendMode === 'error' ? { error: 'rejected' } : { success: true };
  } },
};
const filename = path.join(root, 'src/app/api/waitlist/accept/route.ts'), m = new Module(filename, module);
m.require = id => mocks[id] ?? appReq(id);
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
global.fetch = async (url, options) => { hops.push({ url, options }); return new Response('{}'); };
const call = (token = 'valid') => m.exports.POST(new NextRequest('https://clipwise.ca/api/waitlist/accept', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.invalid' }, body: JSON.stringify({ waitlist_id: 'waiter', barber_id: 'barber', time_slot: '10:00 AM', duration_minutes: 30, total_amount: 25 }) }));
(async () => {
  delete process.env.NEXT_PUBLIC_APP_URL;
  reset(); assert.equal((await call()).status, 200); assert.equal(hops.length, 0, 'customer data must not be posted to request Origin'); assert.equal(sends.length, 1);
  assert.deepEqual(sends[0], { type: 'booking_confirmation', data: { clientName: 'Saved client', clientEmail: email, shopId: 'shop', shopName: 'Saved shop', shopEmail: 'shop@example.invalid', shopSlug: 'saved-shop', serviceName: '', date: '2030-09-18', time: '10:00 AM', total: '$25.00', paymentNote: 'Pay in person at the shop', bookingId: 'APPOINTM', appointmentId: 'appointment-saved' } });
  assert.ok(events.findIndex(e => e[0] === 'appointments') < events.findIndex(e => e[0] === 'email'));
  for (const mode of ['throw', 'error']) { reset(); sendMode = mode; const result = await call(); assert.equal(result.status, 200); assert.equal((await result.json()).appointment_id, 'appointment-saved'); }
  reset(); sendMode = 'wait'; let returned = false; const pending = call().then(res => { returned = true; return res; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof release, 'function'); assert.equal(returned, false, 'await send before returning serverless response'); release(); await pending;
  reset(); email = null; assert.equal((await call()).status, 200); assert.equal(sends.length, 0);
  reset(); actor = 'barber'; assert.equal((await call()).status, 200); assert.equal(sends.length, 1);
  for (const mode of ['auth', 'foreign', 'conflict', 'insert']) {
    reset(); if (mode === 'foreign') actor = 'outsider'; if (mode === 'conflict') conflict = true; if (mode === 'insert') insertError = true;
    assert.equal((await call(mode === 'auth' ? 'bad' : 'valid')).status, { auth: 401, foreign: 403, conflict: 409, insert: 500 }[mode]); assert.equal(sends.length, 0); assert.equal(hops.length, 0);
  }
  console.log('PASS waitlist confirmation: no Origin HTTP hop, awaited direct send, unchanged payload, preserved booked success on email failure, no send before successful authorized booking');
})().catch(error => { console.error(error); process.exitCode = 1; });
