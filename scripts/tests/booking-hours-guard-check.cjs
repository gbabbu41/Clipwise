// Smoke test (2026-09-30, live): a customer reschedule was ACCEPTED onto a day the
// barber doesn't work (Thu) and 2 months out (beyond the 15-day window); and an
// "Anyone" booking could be handed to a barber who isn't working that day. The
// server now enforces the booking screen's rules on every customer path. Also:
// alerts/SMS never show a raw "2026-10-06", and appointment alerts link to it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}

// Tiny in-memory supabase: select/eq/in/lte/gte/maybeSingle over fixture rows.
let T;
const db = { from(table) {
  const f = [];
  const q = {
    select() { return q; }, eq(k, v) { f.push(r => r[k] === v); return q; }, in(k, vs) { f.push(r => vs.includes(r[k])); return q; },
    lte(k, v) { f.push(r => r[k] <= v); return q; }, gte(k, v) { f.push(r => r[k] >= v); return q; },
    maybeSingle() { q.one = true; return q; },
    then(res, rej) { const rows = (T[table] ?? []).filter(r => f.every(fn => fn(r))); return Promise.resolve({ data: q.one ? rows[0] ?? null : rows, error: null }).then(res, rej); },
  };
  return q;
} };
const GILL = 'gill', SOURAB = 'sourab', SHOP = 'shop';
const reset = () => { T = {
  barbers: [{ id: GILL, shop_id: SHOP, is_active: true, bookings_paused: false }, { id: SOURAB, shop_id: SHOP, is_active: true, bookings_paused: false }],
  time_slots: [
    { barber_id: GILL, day_of_week: 1, start_time: '09:00:00', end_time: '19:00:00', is_available: true },
    { barber_id: GILL, day_of_week: 2, start_time: '09:00:00', end_time: '19:00:00', is_available: true },
    { barber_id: SOURAB, day_of_week: 4, start_time: '09:00:00', end_time: '19:00:00', is_available: true },
  ],
  barber_breaks: [{ barber_id: GILL, day_of_week: 2, start_time: '12:45:00', end_time: '13:15:00' }],
  time_off_requests: [], appointments: [],
}; };
const mocks = { '@/lib/supabase-admin': { supabaseAdmin: db } };
const { workingHoursReason, bookableReason } = load('src/lib/schedule-block.ts', mocks);
const { findAvailableBarber } = load('src/lib/booking-conflict.ts', mocks);
const { humanizeDates } = load('src/lib/utils.ts');
const m = t => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };

(async () => {
  reset();
  // 2026-10-05 Mon, 2026-10-06 Tue, 2026-10-01 Thu (Gill works Mon/Tue 9-7; Tue break 12:45-1:15)
  assert.equal(await workingHoursReason(GILL, '2026-10-05', m('10:00'), m('10:30')), null, 'inside hours');
  assert.equal(await workingHoursReason(GILL, '2026-10-05', m('18:30'), m('19:00')), null, 'last slot that fits');
  assert.match(await workingHoursReason(GILL, '2026-10-05', m('18:45'), m('19:15')), /outside the barber's working hours/, 'runs past closing');
  assert.match(await workingHoursReason(GILL, '2026-10-05', m('08:30'), m('09:00')), /outside/, 'before opening');
  assert.match(await workingHoursReason(GILL, '2026-10-01', m('10:00'), m('10:30')), /isn't working that day/, 'day off (Thursday)');
  assert.match(await bookableReason(SHOP, GILL, '2026-10-06', m('12:30'), m('13:00')), /break/, 'break still enforced');
  T.barbers[0].bookings_paused = true;
  assert.match(await workingHoursReason(GILL, '2026-10-05', m('10:00'), m('10:30')), /isn't taking bookings/, 'paused barber');
  reset();

  // "Anyone": never hands a customer booking to a barber who isn't working.
  assert.equal(await findAvailableBarber(SHOP, '2026-10-01', m('10:00'), m('10:30')), SOURAB, 'Thursday → Sourab (works), not Gill (free but off)');
  assert.equal(await findAvailableBarber(SHOP, '2026-10-01', m('10:00'), m('10:30'), GILL), SOURAB, 'even when Gill is "preferred"');
  assert.equal(await findAvailableBarber(SHOP, '2026-10-03', m('10:00'), m('10:30')), null, 'Saturday: nobody working → nobody');
  assert.ok(await findAvailableBarber(SHOP, '2026-10-03', m('10:00'), m('10:30'), undefined, { mode: 'prefer-working' }), 'staff may still book outside hours');
  assert.equal(await findAvailableBarber(SHOP, '2026-10-06', m('12:30'), m('13:00')), null, 'Tuesday lunch: Gill on break, Sourab off → nobody');

  // Dates humanized in alerts + SMS; links / query strings untouched.
  const h = humanizeDates('CW rescheduled to 2026-10-06 at 11:00 AM (was 2026-10-05 at 10:00 AM)');
  assert(!/\d{4}-\d{2}-\d{2}/.test(h) && /October 6/.test(h) && /October 5/.test(h), h);
  assert.equal(humanizeDates('Manage: https://clipwise.ca/my-booking/abc?date=2026-10-06'), 'Manage: https://clipwise.ca/my-booking/abc?date=2026-10-06');

  // Wiring — every customer path enforces it; staff keep their override.
  const src = f => fs.readFileSync(path.join(root, f), 'utf8');
  const inPerson = src('src/app/api/book/in-person/route.ts');
  assert(/if \(!callerIsStaff\) \{\s*const hoursReason = await workingHoursReason\(barberId, b\.date, startMin, endMin\);/.test(inPerson), 'in-person: customers must book inside hours');
  assert(/findAvailableBarber\(b\.shop_id, b\.date, startMin, endMin, undefined, callerIsStaff \? \{ mode: "prefer-working" \} : undefined\)/.test(inPerson), 'in-person: Anyone → working barber for customers');
  assert(src('src/app/api/stripe/booking-checkout/route.ts').includes('await bookableReason(booking.shop_id, resolvedBarberId, booking.date, startMin, endMin)'), 'card checkout checks hours before taking money');
  const manage = src('src/app/api/my-booking/[id]/route.ts');
  assert(manage.includes('await bookableReason(appt.shop_id, appt.barber_id, body.date, startMin, startMin + duration)'), 'reschedule checks hours');
  assert(/isBeyondAdvanceWindow\(body\.date, advanceDays, shopTz\?\.timezone\)/.test(manage), 'reschedule respects the booking window');
  assert(/isBeyondAdvanceWindow\(slotsDate,/.test(manage), 'reschedule offers no times beyond the window');
  assert(src('src/app/api/ai-phone/book/route.ts').includes('await bookableReason(b.shop_id, barberId, b.date, startMin, endMin)'), 'AI phone booking checks hours');
  assert(src('src/app/api/appointments/update/route.ts').includes('{ mode: "prefer-working" }'), 'staff re-pick prefers a working barber');
  assert(src('src/lib/notify-server.ts').includes('message: humanizeDates(r.message)'), 'every alert humanizes dates');
  assert(src('src/lib/twilio.ts').includes('body = humanizeDates(body);'), 'every SMS humanizes dates');
  assert(!/\(\?<[!=]/.test(src('src/lib/utils.ts')), 'no regex lookbehind in browser-shipped utils (older iOS Safari cannot parse it)');
  for (const f of ['src/app/api/my-booking/[id]/route.ts', 'src/app/api/appointments/notify-cancellation/route.ts', 'src/app/api/appointments/update/route.ts', 'src/app/api/webhooks/stripe/route.ts']) {
    assert(/entity_type: "appointment", entity_id:/.test(src(f)), `${f}: appointment alerts link to the appointment`);
  }
  console.log('PASS booking hours guard: working hours / day off / paused / break enforced server-side on every customer path, Anyone never picks an off-duty barber, staff override kept, reschedule window, alerts+SMS humanize dates, appointment alerts linked');
})().catch(e => { console.error(e); process.exitCode = 1; });
