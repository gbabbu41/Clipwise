const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript');
let writes, reads, sideEffects, failedTable, actor, active, paid, connected, inventory, gifts, barbers;
function reset() {
  writes = []; reads = []; sideEffects = []; failedTable = ''; actor = 'owner'; active = true; paid = true; connected = true;
  inventory = { stock: { id: 'stock', shop_id: 'shop', name: 'Product', quantity: 10, low_stock_threshold: 2 }, foreign: { id: 'foreign', shop_id: 'other', quantity: 10 } };
  gifts = { gift: { id: 'gift', shop_id: 'shop', remaining_value: 50 }, foreign: { id: 'foreign', shop_id: 'other', remaining_value: 50 } };
  barbers = { barber: { id: 'barber', shop_id: 'shop' }, foreign: { id: 'foreign', shop_id: 'other' } };
}
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: actor } : null }, error: null }) },
  from(table) {
    let filters = [], operation = 'read', values;
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, maybeSingle() { return q; }, single() { return q; },
      insert(v) { values = v; operation = 'insert'; return q; }, update(v) { values = v; operation = 'update'; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (failedTable === table) return { data: null, error: { message: 'private database details' } };
        if (operation !== 'read') { writes.push({ table, operation, values, filters }); return { data: { id: 'tx' }, error: null }; }
        reads.push({ table, filters });
        const get = key => filters.find(([k]) => k === key)?.[1];
        let data;
        if (table === 'shops') data = { id: 'shop', owner_id: 'owner', name: 'Shop', email: '', booking_settings: {}, subscription_plan: 'pro', subscription_status: 'active', stripe_account_id: 'acct_fixture', stripe_connected: connected };
        else if (table === 'barbers' && get('user_id')) data = actor === 'staff' && active ? { id: 'barber' } : null;
        else data = (table === 'inventory' ? inventory : table === 'gift_cards' ? gifts : barbers)[get('id')];
        if (data && get('shop_id') && data.shop_id && data.shop_id !== get('shop_id')) data = null;
        return { data: data ?? null, error: null };
      }).then(resolve, reject); },
    }; return q;
  },
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db }, './supabase-admin': { supabaseAdmin: db },
  '@/lib/notify-server': { insertNotifications: async () => sideEffects.push('notification') },
  '@/lib/promo': { fetchValidPromo: async () => null, promoBlockReason: async () => null, consumePromo: async () => sideEffects.push('promo') },
  '@/lib/loyalty-redeem': { redeemPointsForDiscount: async () => sideEffects.push('loyalty') },
  '@/lib/clients-server': { upsertClient: async () => sideEffects.push('client') },
  '@/lib/payment-notify': { sendPaymentReceipt: async () => sideEffects.push('receipt') },
  '@/lib/commission-server': { posCommissionFor: async () => 12 },
  '@/lib/validation': { effectivePlan: p => p, planHasFeature: () => paid },
  '@/lib/plans-server': { ensurePlansHydrated: async () => {} },
  '@/lib/stripe': { stripe: { checkout: { sessions: { create: async args => { sideEffects.push({ checkout: args }); return { url: 'https://checkout.invalid' }; } } } } },
};
const cache = {};
function load(relative) { if (cache[relative]) return cache[relative]; const filename = path.join(root, relative), m = new Module(filename, module); m.filename = filename; m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : appReq(id)); m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename); return cache[relative] = m.exports; }
const cash = load('src/app/api/pos/cash-sale/route.ts'), card = load('src/app/api/stripe/pos-checkout/route.ts');
const payload = () => ({ shop_id: 'shop', barber_id: 'barber', amount: 40, total: 46, subtotal: 40, tip: 2, tax: 4, type: 'service', products: [{ id: 'stock', qty: 2 }], client_name: 'Fixture' });
const call = (route, body, token = 'valid') => route.POST(new Request('https://fixture.invalid/pos', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
const noWrites = () => { assert.deepEqual(writes, []); assert.deepEqual(sideEffects, []); };
(async () => {
  for (const route of [cash, card]) {
    for (const patch of [{ products: [{ id: 'foreign', qty: 1 }] }, { barber_id: 'foreign' }, { products: [{ id: 'missing', qty: 1 }] }, { products: [{ id: 'stock', qty: -1 }] }, { products: [{ id: 'stock', qty: 0 }] }, { products: [{ id: 'stock', qty: 1.5 }] }, { products: 'invalid' }]) {
      reset(); assert.equal((await call(route, { ...payload(), ...patch })).status, 400); noWrites();
    }
    for (const table of ['inventory', 'barbers']) { reset(); failedTable = table; const res = await call(route, payload()); assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /private database/); noWrites(); }
    reset(); assert.equal((await call(route, payload(), '')).status, 401); noWrites();
    reset(); actor = 'outsider'; assert.equal((await call(route, payload())).status, 403); noWrites();
    reset(); paid = false; assert.equal((await call(route, payload())).status, 403); noWrites();
    reset(); actor = 'staff'; active = false; assert.equal((await call(route, payload())).status, 403); noWrites();
    for (const who of ['owner', 'staff']) { reset(); actor = who; assert.equal((await call(route, payload())).status, 200); }
    reset(); assert.equal((await call(route, { ...payload(), barber_id: null, products: [] })).status, 200);
  }
  for (const gift of [{ id: 'foreign', applied: 10 }, { id: 'missing', applied: 10 }, { id: 'gift', applied: -1 }, { id: 'gift', applied: '10' }]) { reset(); assert.equal((await call(cash, { ...payload(), gift_card: gift })).status, 400); noWrites(); }
  reset(); failedTable = 'gift_cards'; assert.equal((await call(cash, { ...payload(), gift_card: { id: 'gift', applied: 10 } })).status, 503); noWrites();
  reset(); const res = await call(cash, { ...payload(), gift_card: { id: 'gift', applied: 10 } }); assert.equal(res.status, 200);
  assert.deepEqual(writes[0].values, { shop_id: 'shop', barber_id: 'barber', client_name: 'Fixture', client_email: null, service_name: 'Sale', amount: 40, tip: 2, tax: 4, commission_amount: 12, payment_method: 'cash', type: 'service', source: 'pos' });
  assert.equal(writes.find(w => w.table === 'inventory').values.quantity, 8);
  assert.equal(writes.find(w => w.table === 'gift_cards').values.remaining_value, 40);
  for (const w of writes.filter(w => ['inventory', 'gift_cards'].includes(w.table))) assert.ok(w.filters.some(([k, v]) => k === 'shop_id' && v === 'shop'));
  reset(); await call(card, payload()); const session = sideEffects.find(s => s.checkout).checkout; assert.equal(session.line_items[0].price_data.unit_amount, 4600); assert.equal(session.metadata.barber_id, 'barber');
  reset(); connected = false; assert.equal((await call(card, payload())).status, 409); noWrites();
  const finalize = fs.readFileSync(path.join(root, 'src/app/api/stripe/pos-finalize/route.ts'), 'utf8');
  assert.match(finalize, /eq\("id", p.id\)\.eq\("shop_id", shop_id\)/); assert.match(finalize, /eq\("id", inv.id\)\.eq\("shop_id", shop_id\)/);
  console.log('PASS POS resource isolation: cash/card preflight rejects foreign resources before writes/Checkout, bad quantities/read failures fail closed, valid owner/staff/service/product/gift paths retain totals and scoped writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
