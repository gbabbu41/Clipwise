// Owner booking alerts name the barber ("with Gill") — so the shop knows whose
// chair a new / online / cancelled / rescheduled booking is in. The barber's own
// alert stays about their booking; an owner who is also the barber gets one alert.
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

let fixtures, sent;
const db = { from(table) {
  const q = { select() { return q; }, eq() { return q; }, maybeSingle() { return q; },
    then(res, rej) { return Promise.resolve({ data: fixtures[table] ?? null, error: null }).then(res, rej); } };
  return q;
} };
const { notifyNewBookingStaff } = load('src/lib/notify-staff-server.ts', {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/notify-server': { insertNotifications: async rows => { sent.push(...rows); } },
  '@/lib/utils': { prettyDateWithContext: () => 'Tomorrow · September 29' },
});
const reset = (o = {}) => {
  sent = [];
  fixtures = {
    appointments: { id: 'a1', shop_id: 's1', barber_id: 'b1', client_name: 'Baljit singh Gill', date: '2026-09-29', time_slot: '9:15 AM', status: 'confirmed', payment_status: 'paid', services: { name: 'Skin Fade' } },
    shops: { id: 's1', name: 'FADE MECHANIC', owner_id: 'owner' },
    barbers: { user_id: 'gill-user', name: 'Gill' },
    ...o,
  };
};

(async () => {
  reset();
  await notifyNewBookingStaff('a1');
  const toOwner = sent.find(n => n.user_id === 'owner'), toBarber = sent.find(n => n.user_id === 'gill-user');
  assert.equal(toOwner.message, 'Baljit singh Gill — Skin Fade with Gill on Tomorrow · September 29 at 9:15 AM', 'owner sees the barber');
  assert.equal(toBarber.message, 'Baljit singh Gill — Skin Fade on Tomorrow · September 29 at 9:15 AM', 'barber sees their own booking');
  assert.equal(toOwner.entity_id, 'a1');

  reset({ barbers: { user_id: 'owner', name: 'Owner Chair' } });   // owner is also the barber
  await notifyNewBookingStaff('a1');
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /with Owner Chair/);

  reset({ appointments: { ...fixtures.appointments, barber_id: null, status: 'pending' } });   // any barber + needs approval
  await notifyNewBookingStaff('a1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'New booking — needs approval');
  assert.equal(sent[0].message, 'Baljit singh Gill — Skin Fade with any barber on Tomorrow · September 29 at 9:15 AM · tap to approve');

  reset();
  await notifyNewBookingStaff('a1', { notifyOwner: false });   // online path sends its own owner alert
  assert.deepEqual(sent.map(n => n.user_id), ['gill-user']);

  // The other owner-facing booking alerts name the barber too.
  const src = f => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(src('src/lib/finalize-booking-session.ts'), /booked \$\{ns\?\.name \?\? "an appointment"\} with \$\{nb\?\.name \?\? "any barber"\}/, 'online booking');
  assert.match(src('src/app/api/my-booking/[id]/route.ts'), /cancelled their appointment with \$\{barberName \?\? "any barber"\}/, 'customer cancel');
  assert.match(src('src/app/api/my-booking/[id]/route.ts'), /const ownerMsg = `\$\{msg\} · with \$\{bRow\?\.name \?\? "any barber"\}`/, 'customer reschedule');
  assert.match(src('src/app/api/appointments/update/route.ts'), /→ \$\{prettyWhen\} · with \$\{newBarber\?\.name \?\? "any barber"\}/, 'staff reschedule');

  console.log('PASS booking alerts: owner sees which barber (new, online, cancel, reschedule), barber sees their own, owner-barber gets one, any-barber + approval wording');
})().catch(e => { console.error(e); process.exitCode = 1; });
