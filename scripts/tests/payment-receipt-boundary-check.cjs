const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
let sends = [], mode = '', release;
const mocks = {
  '@/lib/emailer': { sendAppEmail: async (type, data) => { sends.push({ type, data }); if (mode === 'held') await new Promise(resolve => { release = resolve; }); if (mode === 'throw') throw Error('offline'); return mode === 'error' ? { error: 'unavailable' } : { success: true }; } },
  '@/lib/pricing': { taxLabelDetailed: () => 'HST (15%)', receiptGstNumber: () => 'fixture-registration' },
};
const file = path.join(root, 'src/lib/payment-notify.ts'), m = new Module(file, module);
m.require = id => mocks[id] ?? (id.startsWith('@/') ? {} : req(id));
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const args = { clientEmail: 'client@example.invalid', clientName: 'Client', shopName: 'Shop', shopEmail: 'shop@example.invalid', serviceName: 'Cut', date: '2026-09-20', amountCents: 12500, context: 'Appointment completed', taxCents: 1500, tipCents: 1000, time: '11:00 PM', durationMinutes: 75, timezone: 'America/Halifax', items: [{ n: '<Cut>', q: 2, p: 50 }] };
global.fetch = async () => { throw Error('Receipt must never use caller origin'); };
const call = data => m.exports.sendPaymentReceipt('https://attacker.invalid', data);
(async () => {
  await call(args); assert.equal(sends.length, 1); assert.equal(sends[0].type, 'payment_receipt');
  const data = sends[0].data;
  for (const key of ['clientEmail', 'clientName', 'shopName', 'shopEmail', 'serviceName', 'date', 'context']) assert.equal(data[key], args[key]);
  assert.equal(data.amount, '$125.00'); assert.equal(data.subtotal, '$100.00'); assert.equal(data.tax, '$15.00'); assert.equal(data.tip, '$10.00'); assert.equal(data.taxLabel, 'HST (15%)'); assert.equal(data.taxNumber, 'fixture-registration'); assert.equal(data.duration, '1h 15m'); assert.equal(data.apptTime, '11:00 PM'); assert.ok(data.generatedAt); assert.match(data.itemsHtml, /2× &lt;Cut&gt;/); assert.equal(data.itemCount, '2');
  sends = []; await call({ ...args, noShow: true, bookingUrl: 'https://clipwise.ca/book/shop', taxCents: 0 }); assert.equal(sends[0].data.noShow, '1'); assert.equal(sends[0].data.bookingUrl, 'https://clipwise.ca/book/shop'); assert.equal(sends[0].data.subtotal, undefined);
  sends = []; await call({ ...args, taxCents: 99999 }); assert.equal(sends[0].data.tax, undefined);
  for (const patch of [{ clientEmail: null }, { amountCents: 0 }, { amountCents: -100 }]) { sends = []; await call({ ...args, ...patch }); assert.equal(sends.length, 0); }
  for (const failure of ['error', 'throw']) { mode = failure; await assert.doesNotReject(call(args)); }
  mode = 'held'; let done = false; const pending = call(args).then(() => { done = true; }); await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false); release(); await pending;
  console.log('PASS payment receipt: trusted internal transport, preserved tax/tip/itemization/no-show content, empty gates, awaited attempt and failure isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
