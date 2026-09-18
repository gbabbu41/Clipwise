const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript'), { NextRequest } = appReq('next/server');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let appointment, hours, bookings, offs, breaks, failure, today, now, queries;
function reset() {
  appointment = { barber_id: 'barber', shop_id: 'shop', time_slot: '10:00 AM', duration_minutes: 60, services: { duration_minutes: 30 }, shops: { timezone: 'America/Halifax', booking_settings: { slot_interval_minutes: 30 } } };
  hours = [{ start_time: '09:00:00', end_time: '17:00:00' }]; bookings = []; offs = []; breaks = []; failure = ''; today = '2030-10-01'; now = 480; queries = [];
}
const db = { from(table) { let filters = [], many = false; const q = {
  select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, neq(k, v) { filters.push(['neq:' + k, v]); return q; },
  in() { many = true; return q; }, lte() { return q; }, gte() { return q; }, maybeSingle() { return q; },
  then(resolve, reject) { return Promise.resolve().then(() => {
    queries.push({ table, filters });
    const key = table === 'appointments' ? many ? 'bookings' : 'appointment' : table;
    if (failure === key) return { data: null, error: { message: 'private details' } };
    const excluded = filters.find(([k]) => k === 'neq:id')?.[1];
    return { data: table === 'appointments' ? many ? bookings.filter(b => b.id !== excluded) : appointment : table === 'time_slots' ? hours : table === 'time_off_requests' ? offs : breaks, error: null };
  }).then(resolve, reject); },
}; return q; } };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/notify-server': {}, '@/lib/booking-conflict': {}, '@/lib/schedule-block': {},
  '@/lib/stripe-refund': {}, '@/lib/refund-ledger': {}, '@/lib/payment-notify': {}, '@/lib/emailer': {}, '@/lib/twilio': {}, '@/lib/validation': {}, '@/lib/waitlist-notify-server': {},
  '@/lib/rate-limit': { enforceRateLimit: () => null },
  '@/lib/timezone': { safeTz: tz => tz, todayInTz: tz => { assert.equal(tz, 'America/Halifax'); return today; }, nowMinutesInTz: () => now },
};
const cache = {};
function load(relative) { if (cache[relative]) return cache[relative]; const filename = path.join(root, relative), m = new Module(filename, module); m.filename = filename; m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id)); m._compile(compile(fs.readFileSync(filename, 'utf8')), filename); return cache[relative] = m.exports; }
const { GET } = load('src/app/api/my-booking/[id]/route.ts');
const call = (date = '2030-10-02') => GET(new NextRequest(`https://fixture.invalid/api/my-booking/own?slots=${date}`), { params: { id: 'own' } });
async function slots(date) { const res = await call(date); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0'); return (await res.json()).slots; }
const available = (rows, time) => rows.find(r => r.slot === time)?.available ?? false;
const source = fs.readFileSync(path.join(root, 'src/app/my-booking/[id]/page.tsx'), 'utf8');
const handler = source.slice(source.indexOf('  const loadSlots = async'), source.indexOf('  const cancelBooking = async'));
function picker(fetch) {
  const state = { slots: [], loading: false, error: '', time: null }, ref = { current: 0 };
  const env = { appt: { id: 'own' }, slotLoadId: ref, fetch, formatDateForDb: d => d,
    setSlotsLoading: v => { state.loading = v; }, setSlots: v => { state.slots = v; }, setNewTime: v => { state.time = v; }, setRescheduleError: v => { state.error = v; } };
  return { state, ref, load: new Function(...Object.keys(env), `${compile(handler)}; return loadSlots;`)(...Object.values(env)) };
}
(async () => {
  reset(); bookings = [{ id: 'other', time_slot: '10:00 AM', duration_minutes: 60, payment_status: null }]; let rows = await slots();
  assert.equal(available(rows, '9:00 AM'), true); assert.equal(available(rows, '9:30 AM'), false); assert.equal(available(rows, '10:30 AM'), false); assert.equal(available(rows, '11:00 AM'), true); assert.equal(available(rows, '4:30 PM'), false);
  assert.ok(queries.find(q => q.filters.some(([k, v]) => k === 'neq:id' && v === 'own')));
  reset(); bookings = [{ id: 'own', time_slot: '10:00 AM', duration_minutes: 60 }, { id: 'refunded', time_slot: '11:00 AM', duration_minutes: 60, payment_status: 'refunded' }]; rows = await slots(); assert.equal(available(rows, '10:00 AM'), true); assert.equal(available(rows, '11:00 AM'), true);
  reset(); hours = [{ start_time: '09:00', end_time: '12:00' }, { start_time: '13:00', end_time: '17:00' }]; rows = await slots(); assert.equal(available(rows, '11:00 AM'), true); assert.equal(available(rows, '11:30 AM'), false); assert.equal(available(rows, '12:00 PM'), false); assert.equal(available(rows, '1:00 PM'), true);
  reset(); breaks = [{ start_time: '12:00', end_time: '12:30' }]; rows = await slots(); assert.equal(available(rows, '11:30 AM'), false); assert.equal(available(rows, '12:30 PM'), true);
  reset(); hours = [{ start_time: '09:00', end_time: '12:00' }, { start_time: '12:00', end_time: '17:00' }]; assert.equal(available(await slots(), '11:30 AM'), true);
  reset(); offs = [{ type: 'vacation', barber_id: null }]; assert.equal((await slots()).some(r => r.available), false);
  reset(); offs = [{ type: 'day_off', barber_id: 'other' }]; assert.equal((await slots()).some(r => r.available), true);
  reset(); offs = [{ type: 'blocked_hours', barber_id: 'barber', start_time: '14:00', end_time: '15:00' }]; rows = await slots(); assert.equal(available(rows, '1:30 PM'), false); assert.equal(available(rows, '3:00 PM'), true);
  reset(); appointment.duration_minutes = null; appointment.services = [{ duration_minutes: 45 }]; appointment.shops.booking_settings.slot_interval_minutes = 15; rows = await slots(); assert.equal(available(rows, '4:15 PM'), true); assert.equal(available(rows, '4:30 PM'), false);
  reset(); now = 615; rows = await slots(today); assert.equal(available(rows, '10:00 AM'), false); assert.equal(available(rows, '10:30 AM'), true); assert.equal((await slots('2030-09-30')).some(r => r.available), false);
  for (const table of ['appointment', 'bookings', 'time_slots', 'time_off_requests', 'barber_breaks']) { reset(); failure = table; const res = await call(); assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /private details/); }
  reset(); assert.equal((await call('2030-02-30')).status, 400); assert.equal(queries.length, 0);
  reset(); hours = []; assert.deepEqual(await slots(), []);
  const p = picker(async () => ({ ok: false, json: async () => ({ error: 'Unavailable' }) })); await p.load('one'); assert.equal(p.state.error, 'Unavailable'); assert.equal(p.state.loading, false); assert.deepEqual(p.state.slots, []);
  let finishOld, finishNew;
  const race = picker(date => new Promise(resolve => { if (date.endsWith('one')) finishOld = resolve; else finishNew = resolve; }));
  const old = race.load('one'), latest = race.load('two'); finishNew({ ok: true, json: async () => ({ slots: [{ slot: 'new', available: true }] }) }); await latest; finishOld({ ok: true, json: async () => ({ slots: [{ slot: 'old', available: true }] }) }); await old; assert.equal(race.state.slots[0].slot, 'new');
  console.log('PASS customer reschedule slots: duration/overlap, booking-ID exclusion, split shifts, closing time, breaks/time off, timezone, 15-minute grid, failed reads and stale UI response protection');
})().catch(error => { console.error(error); process.exitCode = 1; });
