const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let appt, writeError, missingRow, effects, writes, conflict, block, hours, past, limited, released;
function reset() {
  appt = { id: 'booking', shop_id: 'shop', barber_id: 'barber', service_id: 'service', date: '2030-10-01', time_slot: '10:00 AM', status: 'confirmed', duration_minutes: 60, payment_status: 'paid', payment_intent_id: 'pi_fixture', total_amount: 50, tip_amount: 5, tax_amount: 5, client_name: 'Fixture', client_email: 'fixture@example.invalid', client_phone: '+15555550100', services: { name: 'Cut' } };
  writeError = null; missingRow = false; effects = []; writes = []; conflict = false; block = null; hours = 48; past = false; limited = null; released = false;
}
const db = { from(table) {
  let values, filters = [], selected;
  const q = {
    select(columns) { selected = columns; return q; },
    eq(k, v) { filters.push([k, v]); return q; }, neq() { return q; }, maybeSingle() { return q; },
    update(v) { values = v; return q; },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (values) {
        writes.push({ table, values, filters, selected });
        if (table === 'appointments' && ('status' in values || 'date' in values)) {
          if (writeError) return { data: null, error: writeError };
          if (missingRow) return { data: null, error: null };
          assert.deepEqual(filters, [['id', appt.id], ['status', appt.status], ['date', appt.date], ['time_slot', appt.time_slot]]);
          assert.ok(selected, 'save must request the persisted row');
          effects.push('saved');
          return { data: { ...appt, ...values }, error: null };
        }
        return { data: null, error: null };
      }
      return { data: table === 'appointments' ? appt : table === 'shops' ? { owner_id: 'owner', name: 'Fixture', email: 'shop@example.invalid', stripe_account_id: 'acct_fixture', timezone: 'America/Halifax', booking_settings: { cancellation_hours: 2 }, subscription_plan: 'pro', subscription_status: 'active' } : table === 'barbers' ? { user_id: 'barber-user', name: 'Barber', email: 'barber@example.invalid' } : { name: 'Cut', duration_minutes: 30 }, error: null };
    }).then(resolve, reject); },
  };
  return q;
} };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/notify-server': { insertNotifications: async () => { effects.push('notification'); } },
  '@/lib/stripe-refund': { refundOrReleaseHold: async () => { effects.push('refund'); return { released, refundedCents: 5500 }; } },
  '@/lib/refund-ledger': { recordRefundLedger: async () => { effects.push('ledger'); } },
  '@/lib/payment-notify': { notifyRefundIssued: () => { effects.push('refund-notice'); } },
  '@/lib/emailer': { sendAppEmail: async () => { effects.push('email'); return { success: true }; } },
  '@/lib/twilio': { sendSmsBestEffort: async () => { effects.push('sms'); } },
  '@/lib/validation': { effectivePlan: p => p, isPaidPlan: p => p === 'pro' },
  '@/lib/rate-limit': { enforceRateLimit: () => limited },
  '@/lib/utils': { timeToMinutes: () => 600, prettyDate: d => d },
  '@/lib/timezone': { hoursUntilBooking: () => hours, isBookingInPast: () => past },
  '@/lib/availability': { OCCUPYING_STATUSES: ['pending', 'confirmed'], holdsSlot: () => true },
  '@/lib/schedule-block': { scheduleBlockReason: async () => block },
};
const cache = {};
function load(relative) {
  if (cache[relative]) return cache[relative];
  const filename = path.join(root, relative), m = new Module(filename, module);
  m.filename = filename;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id));
  m._compile(compile(fs.readFileSync(filename, 'utf8')), filename);
  return cache[relative] = m.exports;
}
// Keep the real database error classifier; isolate availability reads.
mocks['@/lib/booking-conflict'] = { ...load('src/lib/booking-conflict.ts'), barberHasConflict: async (...args) => { assert.equal(args[3] - args[2], appt.duration_minutes); return conflict; } };
global.fetch = async () => { effects.push('http-notify'); return new Response('{}'); };
const route = load('src/app/api/my-booking/[id]/route.ts');
const move = { action: 'reschedule', date: '2030-10-02', time_slot: '11:00 AM' };
const invoke = body => route.PATCH(new NextRequest('https://fixture.invalid/api/my-booking/booking', { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: 'booking' } });

// Execute the actual UI handler with isolated state and HTTP responses.
const source = fs.readFileSync(path.join(root, 'src/app/my-booking/[id]/page.tsx'), 'utf8');
const handler = source.slice(source.indexOf('  const reschedule = async () => {'), source.indexOf('  if (loading) {'));
const cancelHandler = source.slice(source.indexOf('  const cancelBooking = async () => {'), source.indexOf('  const reschedule = async () => {'));
async function checkCancelUi(ok, networkFailure = false) {
  const original = { ...appt }, state = { appt: original, view: 'detail', confirm: true, busy: false, error: '' };
  const env = {
    appt: original, setCancelling: v => { state.busy = v; }, setCancelError: v => { state.error = v; },
    setAppt: fn => { state.appt = fn(state.appt); }, setShowCancelConfirm: v => { state.confirm = v; }, setView: v => { state.view = v; },
    fetch: async () => { if (networkFailure) throw new Error('offline'); return { ok, json: async () => ({ error: 'Save failed' }) }; },
  };
  await new Function(...Object.keys(env), `${compile(cancelHandler)}; return cancelBooking();`)(...Object.values(env));
  assert.equal(state.busy, false);
  if (ok && !networkFailure) { assert.equal(state.appt.status, 'cancelled'); assert.equal(state.view, 'cancelled'); assert.equal(state.confirm, false); }
  else { assert.deepEqual(state.appt, original); assert.equal(state.view, 'detail'); assert.equal(state.confirm, true); assert.ok(state.error); }
}
async function checkUi(status, ok = true, networkFailure = false) {
  const original = { ...appt }, state = { appt: original, view: 'reschedule', date: new Date(2030, 9, 2), time: '11:00 AM', error: '', busy: false };
  const env = {
    appt: original, newDate: state.date, newTime: state.time, formatDateForDb: () => move.date,
    setRescheduling: v => { state.busy = v; }, setAppt: fn => { state.appt = fn(state.appt); },
    setView: v => { state.view = v; }, setNewDate: v => { state.date = v; }, setNewTime: v => { state.time = v; }, setSlots: () => {}, setRescheduleError: v => { state.error = v; },
    fetch: async () => { if (networkFailure) throw new Error('offline'); return { ok, json: async () => ({ status, date: move.date, time_slot: move.time_slot, error: 'Save failed' }) }; },
  };
  await new Function(...Object.keys(env), `${compile(handler)}; return reschedule();`)(...Object.values(env));
  assert.equal(state.busy, false);
  if (ok && !networkFailure) { assert.equal(state.appt.status, status ?? original.status); assert.equal(state.appt.date, move.date); assert.equal(state.view, 'detail'); }
  else { assert.deepEqual(state.appt, original); assert.equal(state.view, 'reschedule'); assert.ok(state.date); assert.equal(state.time, move.time_slot); assert.ok(state.error); }
}
(async () => {
  for (const action of [{ action: 'cancel' }, move]) {
    reset(); writeError = { code: 'XX000', message: 'private database details' };
    let res = await invoke(action); assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /private database/); assert.deepEqual(effects, []); assert.equal(writes.length, 1);
    reset(); missingRow = true; res = await invoke(action); assert.equal(res.status, 409); assert.deepEqual(effects, []);
  }
  for (const code of ['23505', 'P0001']) { reset(); writeError = { code }; assert.equal((await invoke(move)).status, 409); assert.deepEqual(effects, []); }
  for (const status of ['confirmed', 'pending']) {
    reset(); appt.status = status;
    const res = await invoke(move); assert.equal(res.status, 200); assert.equal((await res.json()).status, status);
    assert.equal(effects[0], 'saved'); assert.ok(effects.includes('email')); assert.ok(effects.includes('sms')); assert.equal(effects.includes('refund'), false);
    await checkUi(status);
  }
  for (const hold of [false, true]) { reset(); released = hold; appt.payment_status = hold ? 'held' : 'paid'; const res = await invoke({ action: 'cancel' }); assert.equal(res.status, 200); assert.equal((await res.json()).status, 'cancelled'); assert.equal(effects[0], 'saved'); assert.ok(effects.includes('refund')); assert.equal(effects.includes('ledger'), !hold); }
  reset(); appt.payment_intent_id = null; await invoke({ action: 'cancel' }); assert.equal(effects.includes('refund'), false);
  reset(); assert.equal((await invoke({ ...move, date: appt.date, time_slot: appt.time_slot })).status, 200); assert.deepEqual(effects, []); assert.equal(writes.length, 0);
  for (const status of ['cancelled', 'completed', 'no-show']) { reset(); appt.status = status; assert.equal((await invoke(move)).status, 400); assert.equal(writes.length, 0); }
  reset(); hours = 1; assert.equal((await invoke(move)).status, 403); assert.equal(writes.length, 0);
  reset(); conflict = true; assert.equal((await invoke(move)).status, 409); assert.equal(writes.length, 0);
  reset(); block = 'Time off'; assert.equal((await invoke(move)).status, 409); assert.equal(writes.length, 0);
  reset(); past = true; assert.equal((await invoke(move)).status, 400); assert.equal(writes.length, 0);
  reset(); limited = new Response('{}', { status: 429 }); assert.equal((await invoke(move)).status, 429); assert.equal(writes.length, 0);
  reset(); await checkUi(undefined); await checkUi('confirmed', false); await checkUi('confirmed', true, true);
  await checkCancelUi(true); await checkCancelUi(false); await checkCancelUi(true, true);
  console.log('PASS manage booking: rejected/missing saves stop refunds and notifications, overlap conflicts, persisted status, stale-state filters, successful refund/hold/no-card paths, existing policy guards, UI status and retained failed drafts');
})().catch(error => { console.error(error); process.exitCode = 1; });
