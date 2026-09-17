const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json')), ts = appReq('typescript');
function load(file, mocks = {}) {
  const filename = path.join(root, file), m = new Module(filename, module);
  m.filename = filename; m.require = id => mocks[id] ?? appReq(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return m.exports;
}
const { earningsBuckets } = load('src/lib/earnings-chart.ts');
const rows = [{ created_at: '2025-01-12T12:00:00', val: 10 }, { created_at: '2026-01-12T12:00:00', val: 20 }];
let buckets = earningsBuckets(rows, +new Date('2025-01-01T00:00:00'), +new Date('2026-01-31T23:59:59'), true, r => r.val);
assert.equal(buckets.length, 13); assert.equal(buckets[0].val, 10); assert.equal(buckets[12].val, 20); assert.equal(buckets[1].val, 0); assert.notEqual(buckets[0].label, buckets[12].label);
buckets = earningsBuckets([], +new Date('2026-03-01T00:00:00'), +new Date('2026-03-31T23:59:59'), false, () => 0);
assert.equal(buckets.length, 31); assert(buckets.every(b => b.val === 0));
const { inventoryInput, requireInventoryWrite } = load('src/lib/inventory-input.ts');
const form = { name: ' Product ', category: 'Other', price: '10', cost_price: '0', quantity: '0', low_stock_threshold: '0' };
assert.equal(inventoryInput(form).low_stock_threshold, 0); assert.equal(inventoryInput(form).cost_price, 0);
for (const invalid of [{ quantity: '-1' }, { quantity: '1.2' }, { price: 'Infinity' }, { price: 'abc' }, { name: ' ' }]) assert.throws(() => inventoryInput({ ...form, ...invalid }));
assert.throws(() => requireInventoryWrite({ error: null, data: [] })); assert.throws(() => requireInventoryWrite({ error: {}, data: [{ id: 'x' }] })); requireInventoryWrite({ error: null, data: [{ id: 'x' }] });
let failure = '', owner = true, rowCount = 1;
const db = { auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) }, from(table) {
  let offset = 0; const q = { select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; }, limit() { return q; }, range(n) { offset = n; return q; }, maybeSingle() { return q; }, then(resolve, reject) {
    const data = table === 'barbers' ? [{ id: 'barber', shop_id: 'shop', commission_percent: 0, permissions: {}, is_active: true }] : table === 'shops' ? { owner_id: owner ? 'user' : 'other' } : Array.from({ length: Math.min(1000, Math.max(0, rowCount - offset)) }, (_, i) => ({ id: String(offset + i), amount: 100, tip: 10, stripe_fee: 3, refunded: false }));
    return Promise.resolve({ data: failure === table ? null : data, error: failure === table ? { message: 'private database error' } : null }).then(resolve, reject);
  } }; return q;
} };
const { GET } = load('src/app/api/barber/earnings/route.ts', { '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/barber-earnings': load('src/lib/barber-earnings.ts'), '@/lib/read-all-rows': load('src/lib/read-all-rows.ts') });
const { NextRequest } = appReq('next/server');
const request = () => new NextRequest('https://example.invalid/api/barber/earnings?period=all', { headers: { Authorization: 'Bearer test' } });
(async () => {
  for (const table of ['barbers', 'shops', 'transactions']) { failure = table; const res = await GET(request()); assert.equal(res.status, 500); assert(!JSON.stringify(await res.json()).includes('private database')); }
  failure = ''; let body = await (await GET(request())).json(); assert.equal(body.summary.youKeep, 110); assert.equal(body.summary.commissionPercent, 100); assert.equal(body.summary.barberFeeShare, 0);
  rowCount = 1001; body = await (await GET(request())).json(); assert.equal(body.transactions.length, 1001); assert.equal(body.summary.youKeep, 110110);
  console.log('PASS earnings read failures, owner take-home, pagination, year/calendar buckets, inventory validation and confirmed writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
