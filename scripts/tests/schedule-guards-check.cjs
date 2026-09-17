const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript'), { NextRequest } = appReq('next/server');
const barberId = '11111111-1111-4111-8111-111111111111', shopId = '22222222-2222-4222-8222-222222222222';
let barber, actor, failures, writes, rpcFailure, timeOffData, notifications;
function reset() { barber = { id: barberId, shop_id: shopId, user_id: 'staff', is_active: true, permissions: {}, email: null }; actor = 'staff'; failures = new Set(); writes = []; rpcFailure = null; timeOffData = []; notifications = 0; }
const db = { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
  rpc: async (name, args) => { writes.push({ name, args }); return { error: rpcFailure }; },
  from(table) { let operation = 'read', values, many = false; const q = {
    select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; }, limit() { many = true; return q; }, maybeSingle() { return q; }, single() { return q; },
    upsert(v) { operation = 'upsert'; values = v; return q; }, delete() { operation = 'delete'; return q; }, insert(v) { operation = 'insert'; values = v; return q; },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (failures.has(table)) return { data: null, error: { message: 'private database details' } };
      if (operation !== 'read') { writes.push({ table, operation, values }); return { data: {}, error: null }; }
      return { data: table === 'barbers' ? (many ? [barber] : barber) : table === 'shops' ? { id: shopId, owner_id: 'owner' } : table === 'time_off_requests' ? timeOffData : [], error: null };
    }).then(resolve, reject); }
  }; return q; }
};
const cache = {}, mocks = { '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/emailer': { sendAppEmail: async () => ({ success: true }) }, '@/lib/notify-server': { insertNotifications: async () => { notifications++; } }, '@/lib/utils': { prettyDate: x => x } };
function load(relative) { if (cache[relative]) return cache[relative]; const filename = path.join(root, relative), m = new Module(filename, module); m.filename = filename; m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id)); m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename); return cache[relative] = m.exports; }
const schedule = load('src/app/api/schedule/route.ts'), availability = load('src/app/api/barber/availability/route.ts'), off = load('src/app/api/schedule/time-off/route.ts'), block = load('src/app/api/calendar/block/route.ts');
const exclude = load('src/app/api/time-off/exclude-date/route.ts');
const request = (body, method = 'POST', url = 'https://clipwise.ca/api/schedule') => new NextRequest(url, { method, headers: { Authorization: 'Bearer valid' }, ...(method !== 'GET' && method !== 'DELETE' ? { body: JSON.stringify(body) } : {}) });
const day = { day_of_week: 1, is_open: true, start_time: '09:00', end_time: '17:00' };
const scheduleBody = () => ({ barber_id: barberId, days: [day], breaks: [] });
(async () => {
  reset(); let res = await availability.PUT(request({ slots: [{ ...day, is_available: true, barber_id: 'victim', shop_id: 'foreign', id: 'foreign' }] }, 'PUT'));
  assert.equal(res.status, 200); assert.equal(writes.length, 1); assert.equal(writes[0].values[0].barber_id, barberId); assert.equal('id' in writes[0].values[0], false); assert.equal('shop_id' in writes[0].values[0], false);
  for (const body of [null, {}, { ...scheduleBody(), days: [day, day] }, { ...scheduleBody(), days: [{ ...day, end_time: '08:00' }] }, { ...scheduleBody(), breaks: [{ day_of_week: 1, start_time: '08:00', end_time: '10:00' }] }]) {
    reset(); assert.equal((await schedule.POST(request(body))).status, 400); assert.equal(writes.length, 0);
  }
  for (const state of [{ is_active: false }, { permissions: { edit_schedule: false } }, { user_id: 'other' }]) {
    reset(); Object.assign(barber, state); assert.equal((await schedule.POST(request(scheduleBody()))).status, 403); assert.equal(writes.length, 0);
  }
  reset(); actor = 'owner'; barber.is_active = false; barber.permissions.edit_schedule = false; assert.equal((await schedule.POST(request(scheduleBody()))).status, 200); assert.equal(writes[0].args.p_actor_id, 'owner');
  reset(); rpcFailure = { code: 'PGRST202' }; res = await schedule.POST(request(scheduleBody())); assert.equal(res.status, 503); assert.match((await res.json()).error, /existing schedule is unchanged/); assert.equal(writes.length, 1); assert.equal(writes[0].name, 'replace_barber_schedule');
  for (const table of ['barbers', 'shops', 'time_slots', 'barber_breaks', 'time_off_requests']) {
    reset(); failures.add(table); assert.equal((await schedule.GET(request(null, 'GET', `https://clipwise.ca/api/schedule?barber_id=${barberId}`))).status, 503);
  }
  reset(); failures.add('time_slots'); assert.equal((await availability.PUT(request({ slots: [{ ...day, is_available: true }] }, 'PUT'))).status, 500);
  const offBody = { barber_id: barberId, type: 'day_off', start_date: '2026-09-18', end_date: '2026-09-19' };
  reset(); barber.permissions.request_time_off = false; assert.equal((await off.POST(request(offBody))).status, 403); assert.equal(writes.length, 0);
  reset(); assert.equal((await off.POST(request({ ...offBody, start_date: '2026-02-30' }))).status, 400);
  reset(); barber.is_active = false; assert.equal((await block.POST(request({ shop_id: shopId, barber_id: barberId, date: '2026-09-18', start_time: '09:00', end_time: '10:00' }))).status, 403);
  reset(); barber.permissions.block_hours = false; assert.equal((await block.POST(request({ shop_id: shopId, barber_id: barberId, date: '2026-09-18', start_time: '09:00', end_time: '10:00' }))).status, 403);
  const excludeBody = { request_id: barberId, exclude_date: '2026-09-18' };
  function approved() { reset(); actor = 'owner'; timeOffData = { id: barberId, shop_id: shopId, type: 'vacation', status: 'approved', start_date: '2026-09-17', end_date: '2026-09-19', shops: { id: shopId, owner_id: 'owner' }, barbers: { user_id: 'staff' } }; }
  for (const value of [null, {}, { ...excludeBody, exclude_date: '2026-02-30' }, { ...excludeBody, request_id: 'invalid' }]) { approved(); assert.equal((await exclude.POST(request(value))).status, 400); assert.equal(writes.length, 0); }
  for (const patch of [{ status: 'pending' }, { type: 'blocked_hours' }, { start_date: '2026-09-19' }]) { approved(); Object.assign(timeOffData, patch); assert.equal((await exclude.POST(request(excludeBody))).status, 400); assert.equal(writes.length, 0); }
  approved(); actor = 'foreign'; assert.equal((await exclude.POST(request(excludeBody))).status, 403);
  approved(); failures.add('time_off_requests'); assert.equal((await exclude.POST(request(excludeBody))).status, 503); assert.equal(writes.length, 0);
  for (const code of ['PGRST202', '23514']) { approved(); rpcFailure = { code }; assert.equal((await exclude.POST(request(excludeBody))).status, 503); assert.equal(notifications, 0); assert.equal(writes.length, 1); assert.equal(writes[0].name, 'exclude_time_off_date'); }
  approved(); assert.equal((await exclude.POST(request(excludeBody))).status, 200); assert.equal(notifications, 1); assert.deepEqual(writes[0].args, { p_actor_id: 'owner', p_request_id: barberId, p_exclude_date: '2026-09-18' });
  console.log('PASS schedule identity allowlist, input validation, active membership, permission and owner overrides, failed reads/writes, atomic schedule/exclusion RPCs, notification-after-success and missing-migration preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
