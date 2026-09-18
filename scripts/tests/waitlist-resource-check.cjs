const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
let actor, rows, failures, queries, writes, sends, conflictChecks;
function reset() {
  actor = 'owner'; failures = new Set(); queries = []; writes = []; sends = []; conflictChecks = [];
  const waiter = { id: 'waiter', shop_id: 'shop', service_id: 'service', client_name: 'Fixture', client_email: 'fixture@example.invalid', client_phone: '', desired_date: '2030-09-18', status: 'waiting' };
  rows = {
    appointment_waitlist: [waiter], waitlist: [{ ...waiter }],
    shops: [{ id: 'shop', owner_id: 'owner', name: 'Shop', slug: 'shop', timezone: 'America/Halifax' }],
    barbers: [{ id: 'barber', shop_id: 'shop', user_id: 'staff', is_active: true, name: 'Staff' }, { id: 'second', shop_id: 'shop', user_id: 'second-user', is_active: false }, { id: 'foreign', shop_id: 'other', user_id: 'foreign-user', is_active: true }],
    services: [{ id: 'service', shop_id: 'shop', name: 'Haircut', duration_minutes: 45, price: 35 }, { id: 'foreign', shop_id: 'other', name: 'Other service', duration_minutes: 90, price: 100 }],
  };
}
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: actor } : null } }) },
  from(table) {
    let filters = [], values, insert = false;
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, maybeSingle() { return q; }, single() { return q; },
      insert(v) { values = v; insert = true; return q; }, update(v) { values = v; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        queries.push({ table, filters });
        if (values) { writes.push({ table, values, insert }); return { data: insert ? { id: 'saved-appointment' } : null, error: null }; }
        if (failures.has(table)) return { data: null, error: { message: 'private database detail' } };
        return { data: (rows[table] ?? []).find(r => filters.every(([k, v]) => r[k] === v)) ?? null, error: null };
      }).then(resolve, reject); },
    }; return q;
  },
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/ensure-client': { ensureClientRow: async () => null },
  '@/lib/booking-conflict': { barberHasConflict: async (...args) => { conflictChecks.push(args); return false; }, isDoubleBookError: () => false },
  '@/lib/utils': { timeToMinutes: () => 600, prettyDate: d => d }, '@/lib/timezone': { isBookingInPast: () => false },
  '@/lib/twilio': { sendSmsBestEffort: async (...args) => sends.push(args) },
  '@/lib/emailer': { sendAppEmail: async (...args) => { sends.push(args); return { success: true }; } },
};
function load(name) {
  const file = path.join(root, `src/app/api/waitlist/${name}/route.ts`), m = new Module(file, module);
  m.require = id => mocks[id] ?? appReq(id);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports.POST;
}
const routes = { accept: load('accept'), seat: load('seat') };
const call = (name, extra = {}, token = 'valid') => routes[name](new NextRequest(`https://clipwise.ca/api/waitlist/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ waitlist_id: 'waiter', barber_id: 'barber', time_slot: '10:00 AM', ...extra }) }));
const noEffects = () => { assert.equal(writes.length, 0); assert.equal(sends.length, 0); assert.equal(conflictChecks.length, 0); };
(async () => {
  for (const name of Object.keys(routes)) {
    for (const field of ['barber_id', 'service_id']) for (const id of ['foreign', 'missing']) {
      reset(); assert.equal((await call(name, { [field]: id })).status, 400, `${name} rejects ${field}=${id}`); noEffects();
    }
    for (const table of ['barbers', 'services']) { reset(); failures.add(table); const r = await call(name); assert.equal(r.status, 503); assert.doesNotMatch(await r.text(), /private database detail/); noEffects(); }
    reset(); rows[name === 'accept' ? 'appointment_waitlist' : 'waitlist'][0].service_id = 'foreign'; assert.equal((await call(name)).status, 400); noEffects();
    for (const who of ['owner', 'staff']) {
      reset(); actor = who; assert.equal((await call(name)).status, 200);
      const saved = writes.find(w => w.insert).values; assert.equal(saved.shop_id, 'shop'); assert.equal(saved.barber_id, 'barber'); assert.equal(saved.service_id, 'service'); assert.equal(saved.duration_minutes, 45); assert.equal(saved.total_amount, 35);
      for (const table of ['barbers', 'services']) assert.ok(queries.some(q => q.table === table && q.filters.some(([k]) => k === 'id') && q.filters.some(([k, v]) => k === 'shop_id' && v === 'shop')));
    }
    reset(); rows[name === 'accept' ? 'appointment_waitlist' : 'waitlist'][0].service_id = null; assert.equal((await call(name)).status, 200); const free = writes.find(w => w.insert).values; assert.equal(free.service_id, null); assert.equal(free.duration_minutes, 30); assert.equal(free.total_amount, 0);
    reset(); actor = 'outsider'; assert.equal((await call(name)).status, 403); noEffects();
    reset(); assert.equal((await call(name, {}, 'bad')).status, 401); noEffects();
  }
  reset(); assert.equal((await call('accept', { duration_minutes: 60, total_amount: 19 })).status, 200); const override = writes.find(w => w.insert).values; assert.equal(override.duration_minutes, 60); assert.equal(override.total_amount, 19);
  reset(); actor = 'staff'; assert.equal((await call('seat', { barber_id: 'second' })).status, 403); noEffects();
  reset(); actor = 'staff'; assert.equal((await call('accept', { barber_id: 'second' })).status, 200); // Existing smart-waitlist policy differs from walk-in seating.
  console.log('PASS waitlist resource ownership: both routes reject foreign/missing resources and failed reads before writes/conflicts/sends; valid owner/staff, service defaults, manual overrides and existing assignment permissions preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
