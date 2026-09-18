const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
let sends, hops, sms, notices, hasEmail, status, paid, sendMode, release;
function reset() { sends = []; hops = []; sms = []; notices = []; hasEmail = true; status = 'cancelled'; paid = true; sendMode = ''; release = null; }
const db = { from(table) {
  const q = { select() { return q; }, eq() { return q; }, maybeSingle() { return q; }, then(resolve, reject) {
    const rows = {
      appointments: { id: 'appointment', shop_id: 'shop', barber_id: 'barber', status, client_name: 'Saved client', client_phone: '+15555550100', service_id: 'service', date: '2030-09-18', time_slot: '10:00 AM' },
      barbers: { name: 'Saved barber', email: hasEmail ? 'barber@example.invalid' : null, user_id: 'staff' },
      shops: { name: 'Saved shop', email: 'shop@example.invalid', subscription_plan: 'pro', subscription_status: 'active' },
      services: { name: 'Saved service' },
    };
    return Promise.resolve({ data: rows[table], error: null }).then(resolve, reject);
  } }; return q;
} };
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/rate-limit': { enforceRateLimit: () => null },
  '@/lib/notify-server': { insertNotifications: data => notices.push(data) },
  '@/lib/twilio': { sendSmsBestEffort: async (...args) => sms.push(args) },
  '@/lib/validation': { effectivePlan: () => 'pro', isPaidPlan: () => paid },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (sendMode === 'throw') throw Error('offline'); if (sendMode === 'wait') await new Promise(resolve => { release = resolve; }); return sendMode === 'error' ? { error: 'rejected' } : { success: true }; } },
};
const file = path.join(root, 'src/app/api/appointments/notify-cancellation/route.ts'), m = new Module(file, module);
m.require = id => mocks[id] ?? appReq(id);
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
global.fetch = async (...args) => { hops.push(args); return new Response('{}'); };
const call = (extra = {}) => m.exports.POST(new NextRequest('https://clipwise.ca/api/appointments/notify-cancellation', { method: 'POST', headers: { Origin: 'https://attacker.invalid' }, body: JSON.stringify({ appointment_id: 'appointment', notifyCustomer: true, ...extra }) }));
(async () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://clipwise.ca';
  reset(); assert.equal((await call()).status, 200); assert.equal(hops.length, 0); assert.equal(sends.length, 1); assert.equal(sms.length, 1); assert.equal(notices.length, 1);
  assert.deepEqual(sends[0], { type: 'barber_appointment_change', data: { barberEmail: 'barber@example.invalid', barberName: 'Saved barber', shopName: 'Saved shop', shopEmail: 'shop@example.invalid', clientName: 'Saved client', serviceName: 'Saved service', date: '2030-09-18', time: '10:00 AM', statusLabel: 'Cancelled' } });
  for (const mode of ['throw', 'error']) { reset(); sendMode = mode; assert.equal((await call()).status, 200); assert.equal(sms.length, 1); }
  reset(); sendMode = 'wait'; let returned = false; const pending = call().then(() => { returned = true; }); await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof release, 'function'); assert.equal(returned, false); release(); await pending;
  reset(); hasEmail = false; assert.equal((await call()).status, 200); assert.equal(sends.length, 0); assert.equal(sms.length, 1);
  for (const mode of ['active', 'starter', 'customer', 'no-show']) {
    reset(); if (mode === 'active') status = 'confirmed'; if (mode === 'starter') paid = false;
    assert.equal((await call(mode === 'customer' ? { notifyCustomer: false } : mode === 'no-show' ? { statusLabel: 'No-show' } : {})).status, 200);
    assert.equal(sms.length, 0); assert.equal(sends.length, 1); assert.equal(hops.length, 0);
  }
  console.log('PASS cancellation email: direct awaited delivery ignores Origin, saved recipients/payload, email failures preserve response, existing paid/cancelled/customer/no-show SMS rules');
})().catch(error => { console.error(error); process.exitCode = 1; });
