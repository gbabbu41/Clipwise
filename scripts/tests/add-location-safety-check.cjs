const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
let shops, readError, inserts, bills, native, authenticated, insertError, selected;
function reset() {
  shops = [{ id: 'primary', subscription_plan: 'premium', subscription_status: 'active', stripe_subscription_id: null,
    trial_ends_at: new Date(Date.now() + 86400000).toISOString(), trial_used: true, trial_ended_at: null,
    booking_settings: { bookings_paused: true, slot_interval_minutes: 15 } }];
  readError = null; inserts = []; bills = []; native = false; authenticated = true; insertError = null; selected = '';
}
const db = { auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'owner', email: 'owner@example.test' } : null }, error: null }) },
  from(table) {
    assert.equal(table, 'shops'); let row;
    const q = { select(columns) { if (!row) selected = columns; return q; }, eq(key, value) { assert.equal(key, 'owner_id'); assert.equal(value, 'owner'); return q; },
      order() { return q; }, single() { return q; }, insert(value) { row = value; inserts.push(value); return q; },
      then(resolve, reject) { return Promise.resolve(row ? { data: insertError ? null : { ...row, id: 'new-location' }, error: insertError } : { data: shops, error: readError }).then(resolve, reject); }
    }; return q;
  }
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/plans-server': { ensurePlansHydrated: async () => {} },
  '@/lib/validation': { effectivePlan: (plan, status) => status === 'active' ? plan : 'starter', planAllowsMultiLocation: plan => plan === 'premium', getLocationLimit: () => 2, MAX_LOCATIONS: 10 },
  '@/lib/timezone': { tzForProvince: () => 'America/Halifax', DEFAULT_TZ: 'America/Toronto' },
  '@/lib/stripe-addons': { reconcileLocationAddon: async (...args) => { bills.push(args); } },
  '@/lib/native-app': { isNativeRequest: () => native },
};
const filename = path.join(root, 'src/app/api/shops/add-location/route.ts'), m = new Module(filename, module);
m.filename = filename; m.require = id => mocks[id] ?? appReq(id);
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const request = body => new NextRequest('https://clipwise.ca/api/shops/add-location', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) });
const post = body => m.exports.POST(request(body));
(async () => {
  reset(); assert.equal((await post({ name: ' New location ', trial_ends_at: '2099-01-01', trial_used: false })).status, 200);
  assert.equal(inserts[0].trial_ends_at, shops[0].trial_ends_at); assert.equal(inserts[0].trial_used, true); assert.equal(inserts[0].trial_ended_at, null);
  assert.equal(inserts[0].name, 'New location'); assert.equal(inserts[0].booking_settings.bookings_paused, false);
  assert.equal(inserts[0].booking_settings.slot_interval_minutes, 15); assert.equal('stripe_account_id' in inserts[0], false); assert.equal(bills.length, 0);
  for (const field of ['trial_ends_at', 'trial_used', 'trial_ended_at']) assert.ok(selected.split(', ').includes(field));
  reset(); shops[0].trial_used = false; await post({ name: 'Second' }); assert.equal(inserts[0].trial_used, true);
  reset(); Object.assign(shops[0], { stripe_subscription_id: 'sub_paid', stripe_customer_id: 'cus_paid', trial_ends_at: null, trial_ended_at: '2026-01-01T00:00:00Z' });
  assert.equal((await post({ name: 'Second' })).status, 200); assert.equal(inserts[0].trial_ends_at, null); assert.equal(inserts[0].trial_used, true);
  assert.equal(inserts[0].trial_ended_at, shops[0].trial_ended_at); assert.equal(inserts[0].stripe_subscription_id, 'sub_paid');
  for (const expiry of ['2020-01-01T00:00:00Z', 'invalid']) {
    reset(); shops[0].trial_ends_at = expiry; assert.equal((await post({ name: 'Second' })).status, 403); assert.equal(inserts.length, 0); assert.equal(bills.length, 0);
  }
  for (const body of [null, [], 1, {}, { name: 1 }, { name: ' ' }, { name: 'Second', province: {} }, { name: 'Second', phone: [] }, { name: 'Second', description: 42 }, { name: 'Second', agree_addon: 'false' }, { name: 'Second', agree_addon: 1 }]) {
    reset(); assert.equal((await post(body)).status, 400); assert.equal(inserts.length, 0); assert.equal(bills.length, 0);
  }
  reset(); readError = { message: 'private database detail' }; let response = await post({ name: 'Second' });
  assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(await response.json()), /private database/); assert.equal(inserts.length, 0); assert.equal(bills.length, 0);
  reset(); shops = null; assert.equal((await post({ name: 'Second' })).status, 503); assert.equal(inserts.length, 0);
  reset(); shops = []; assert.equal((await post({ name: 'Second' })).status, 400);
  reset(); authenticated = false; assert.equal((await post({ name: 'Second' })).status, 401);
  reset(); native = true; assert.equal((await post({ name: 'Second' })).status, 403);
  reset(); shops[0].stripe_subscription_id = 'sub_paid'; shops.push({ ...shops[0], id: 'second' });
  assert.equal((await post({ name: 'Third' })).status, 409); assert.equal(inserts.length, 0); assert.equal(bills.length, 0);
  assert.equal((await post({ name: 'Third', agree_addon: true })).status, 200); assert.deepEqual(bills, [['sub_paid', 1, { invoiceNow: true }]]);
  reset(); shops[0].stripe_subscription_id = 'sub_paid'; shops.push({ ...shops[0], id: 'second' }); insertError = { message: 'write failed' };
  assert.equal((await post({ name: 'Third', agree_addon: true })).status, 500); assert.deepEqual(bills, [['sub_paid', 1, { invoiceNow: true }], ['sub_paid', 0]]);
  // Exercise the actual settings handler without mounting unrelated settings tabs.
  const settingsSource = fs.readFileSync(path.join(root, 'src/app/dashboard/settings/page.tsx'), 'utf8');
  const settingsAst = ts.createSourceFile('settings.tsx', settingsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(settingsAst) === 'addLocation') handler = node.initializer.getText(settingsAst); ts.forEachChild(node, visit); }
  visit(settingsAst); assert.ok(handler);
  const handlerJs = ts.transpileModule(`const handler = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  function client(fetchImpl, refreshShop = async () => {}) {
    const state = { busy: false, confirmed: false, active: null, toasts: [] };
    const bindings = { addingLocationRef: { current: false }, newLocation: { name: 'New', description: '' }, accessToken: 'test', canMultiLocation: true, willCostAddon: false, confirmingAddon: false,
      setAddingLocation: v => { state.busy = v; }, setConfirmingAddon: v => { state.confirmed = v; }, showToast: v => state.toasts.push(v), setShowAddLocation: () => {}, setNewLocation: () => {}, BLANK_LOCATION: {},
      refreshShop, setActiveShop: v => { state.active = v; }, fetch: fetchImpl, AbortSignal };
    return { state, run: new Function(...Object.keys(bindings), `${handlerJs}\nreturn handler;`)(...Object.values(bindings)) };
  }
  let ui = client(async () => { throw new Error('offline'); }); await ui.run(); assert.equal(ui.state.busy, false); assert.match(ui.state.toasts[0], /check your locations before trying again/);
  ui = client(async () => ({ ok: false, json: async () => ({ needsConfirm: true }) })); await ui.run(); assert.equal(ui.state.busy, false); assert.equal(ui.state.confirmed, true);
  let finish, fetches = 0;
  ui = client(async (_url, options) => { fetches++; assert.ok(options.signal); return new Promise(resolve => { finish = resolve; }); });
  const pending = ui.run(); await ui.run(); assert.equal(fetches, 1); assert.equal(ui.state.busy, true);
  finish({ ok: true, json: async () => ({ shop: { id: 'created' } }) }); await pending; assert.equal(ui.state.busy, false); assert.equal(ui.state.active.id, 'created');
  ui = client(async () => ({ ok: true, json: async () => ({ shop: { id: 'created' } }) }), async () => { throw new Error('refresh failed'); });
  await ui.run(); assert.equal(ui.state.busy, false); assert.match(ui.state.toasts.at(-1), /Location added, but the list couldn't refresh/);
  console.log('PASS additional-location trial inheritance/expiry/history, input validation, failed-read safety, native/auth gates and unchanged add-on consent/rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });
