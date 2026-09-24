const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const { NextRequest } = req('next/server');
const emailSource = fs.readFileSync(path.join(root, 'src/lib/emailer.ts'), 'utf8');
const types = name => Function(emailSource.match(new RegExp('export const ' + name + ' = new Set\\(\\[[\\s\\S]*?\\]\\);'))[0].replace('export ', '') + ';return ' + name)();
const appointmentId = '11111111-1111-4111-8111-111111111111';
const shopId = '22222222-2222-4222-8222-222222222222';
let actor, status, email, verified, missingShop, sends, recipientExists, permission, failTable;
function reset() { actor = 'owner'; status = 'confirmed'; email = 'saved@example.invalid'; verified = true; missingShop = false; sends = []; recipientExists = true; permission = true; failTable = ''; shop.is_active = true; }
const shop = { id: shopId, owner_id: 'owner', name: 'Saved Shop', email: 'shop@example.invalid', slug: 'saved-shop', status: 'approved', is_active: true, users: { email: 'owner@example.invalid' } };
reset();
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: actor, email: 'applicant@example.invalid', email_confirmed_at: verified ? '2026-09-01' : null } : null }, error: null }) },
  from(table) {
    const filters = []; let limit = false;
    const q = {
      select() { return q; }, eq(...args) { filters.push(args); return q; }, ilike(...args) { filters.push(args); return q; }, limit() { limit = true; return q; }, maybeSingle() { return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        let data = null;
        if (table === 'appointments') data = filters.some(([k,v]) => k === 'id' && v === appointmentId)
          ? { id: appointmentId, shop_id: shopId, service_id: 'service', barber_id: 'assigned', client_name: 'Saved Customer', client_email: email, status, date: '2026-09-24', time_slot: '10:00', total_amount: 35, tip_amount: 5 } :
          recipientExists ? [{ client_name: 'Saved Customer', client_email: email }] : [];
        else if (table === 'shops') data = missingShop ? null : shop;
        else if (table === 'services') data = { name: 'Saved Cut' };
        else if (table === 'barbers') data = filters.some(([k]) => k === 'user_id') ? actor === 'barber' ? { permissions: { manage_appointments: permission } } : null : { name: 'Saved Barber' };
        else if (table === 'clients') data = recipientExists ? [{ id: 'client-id', name: 'Saved Customer', email }] : [];
        else if (table === 'transactions') data = [];
        else throw Error(table);
        if (limit) assert.ok(filters.some(([k,v]) => k === 'shop_id' && v === shopId), 'recipient lookup must be shop-scoped');
        return failTable === table ? { data: null, error: { message: 'private failure' } } : { data, error: null };
      }).then(resolve, reject); },
    };
    return q;
  },
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, './supabase-admin': { supabaseAdmin: db },
  '@/lib/emailer': { SERVER_ONLY_EMAIL_TYPES: types('SERVER_ONLY_EMAIL_TYPES'), PRIVILEGED_EMAIL_TYPES: types('PRIVILEGED_EMAIL_TYPES'), sendAppEmail: async (type,data) => { sends.push({ type,data }); return { success: true }; } },
  '@/lib/validation': {}, '@/lib/plans-server': {}, '@/lib/rate-limit': { enforceRateLimit: () => null },
};
function load(relative) {
  const file = path.join(root, relative), m = new Module(file, module);
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load('src/' + id.slice(2) + '.ts') : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,file);
  return m.exports;
}
const { POST } = load('src/app/api/send-email/route.ts');
const call = (type, data, token = 'valid', secret = false) => POST(new NextRequest('https://clipwise.ca/api/send-email', {
  method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(secret ? { 'x-internal-secret': 'fixture' } : {}) }, body: JSON.stringify({ type, data }),
}));
(async () => {
  process.env.RESEND_API_KEY = 'dummy'; process.env.CRON_SECRET = 'fixture'; process.env.NEXT_PUBLIC_APP_URL = 'https://preview.example.invalid/';
  const forged = { appointmentId, clientEmail: 'attacker@example.invalid', shopName: 'Fake Shop', bookingUrl: 'https://attacker.invalid' };
  for (const type of ['booking_confirmation', 'appointment_rejected', 'no_show_followup']) {
    reset(); status = type === 'booking_confirmation' ? 'confirmed' : type === 'appointment_rejected' ? 'cancelled' : 'no-show';
    assert.equal((await call(type, forged, '', true)).status, 401, `${type}: shared secret must not bypass appointment auth`);
    assert.equal(sends.length, 0);
    actor = 'foreign'; assert.equal((await call(type, forged)).status, 403); assert.equal(sends.length, 0);
    actor = 'owner'; assert.equal((await call(type, forged)).status, 200);
    assert.equal(sends[0].data.clientEmail, email); assert.equal(sends[0].data.shopName, shop.name);
    assert.ok(!JSON.stringify(sends[0].data).includes('attacker.invalid'));
    assert.equal(sends[0].data.appointmentId, appointmentId);
  }
  reset(); status = 'pending'; assert.equal((await call('booking_confirmation', forged)).status, 409); assert.equal(sends.length, 0);
  reset(); assert.equal((await call('booking_request_received', forged, '', true)).status, 403); assert.equal(sends.length, 0);
  reset(); assert.equal((await call('booking_confirmation', { ...forged, appointmentId: 'bad' })).status, 400); assert.equal(sends.length, 0);
  reset(); actor = 'barber'; assert.equal((await call('booking_confirmation', forged)).status, 200);
  reset(); actor = 'barber'; permission = false; assert.equal((await call('booking_confirmation', forged)).status, 403); assert.equal(sends.length, 0);

  const rebooking = { shopId, clientEmail: email, bookingUrl: 'https://attacker.invalid', shopName: 'Fake' };
  reset(); actor = 'foreign'; assert.equal((await call('rebooking_reminder', rebooking)).status, 403); assert.equal(sends.length, 0);
  reset(); assert.equal((await call('rebooking_reminder', { ...rebooking, clientEmail: 'attacker@example.invalid' })).status, 404); assert.equal(sends.length, 0);
  reset(); assert.equal((await call('rebooking_reminder', rebooking)).status, 200);
  assert.equal(sends[0].data.clientEmail, email); assert.equal(sends[0].data.bookingUrl, 'https://preview.example.invalid/book/saved-shop');
  assert.equal(sends[0].data.unsubscribeUrl, 'https://preview.example.invalid/api/unsubscribe?c=client-id');
  reset(); failTable = 'clients'; assert.equal((await call('rebooking_reminder', rebooking)).status, 503); assert.equal(sends.length, 0);

  const join = { shopId, ownerEmail: 'attacker@example.invalid', shopName: 'Fake', barberName: 'Applicant', barberEmail: 'forged@example.invalid' };
  reset(); assert.equal((await call('new_barber_request', join, '')).status, 401); assert.equal(sends.length, 0);
  reset(); verified = false; assert.equal((await call('new_barber_request', join)).status, 401); assert.equal(sends.length, 0);
  reset(); assert.equal((await call('new_barber_request', join)).status, 200);
  assert.equal(sends[0].data.ownerEmail, 'owner@example.invalid'); assert.equal(sends[0].data.barberEmail, 'applicant@example.invalid');
  assert.equal(sends[0].data.shopName, shop.name);
  reset(); missingShop = true; assert.equal((await call('new_barber_request', join)).status, 404); assert.equal(sends.length, 0);
  reset(); shop.is_active = false; assert.equal((await call('new_barber_request', join)).status, 404); assert.equal(sends.length, 0);
  reset(); failTable = 'shops'; assert.equal((await call('new_barber_request', join)).status, 503); assert.equal(sends.length, 0);

  const booking = fs.readFileSync(path.join(root, 'src/app/book/[shopslug]/booking-client.tsx'), 'utf8');
  assert.doesNotMatch(booking, /type: inPersonStatus === "pending" \? "booking_request_received"/);
  console.log('PASS customer email boundary: saved booking/client/shop recipients, tenant gates, join identity, forged links, public duplicate removal');
})().catch(error => { console.error(error); process.exitCode = 1; });
