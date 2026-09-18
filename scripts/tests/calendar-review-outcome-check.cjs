const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
let mode, stamps, requests, release;
const appt = { id: 'appt', shop_id: 'shop', client_email: 'client@example.invalid', client_name: 'Client', date: '2026-09-18', total_amount: 100, services: { name: 'Cut' }, barbers: { name: 'Barber' } };
const shop = { id: 'shop', name: 'Shop', email: 'owner@example.invalid', slug: 'shop', google_place_id: 'place_fixture' };
const db = { from(table) { let patch; const q = { select() { return q; }, eq() { return q; }, maybeSingle() { return q; }, update(value) { patch = value; return q; }, then(resolve, reject) { if (patch) stamps.push({ table, patch }); return Promise.resolve({ data: null, error: null }).then(resolve, reject); } }; return q; } };
const file = path.join(root, 'src/lib/appointment-actions.ts'), m = new Module(file, module); m.require = id => id === '@/lib/utils' ? { prettyDate: value => value } : req(id); m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
global.window = { location: { origin: 'https://clipwise.ca' } };
global.fetch = async (url, init) => { requests.push({ url, init }); if (url !== '/api/send-email') return { ok: true }; if (mode === 'throw') throw Error('offline'); if (mode === 'held') await new Promise(resolve => { release = resolve; }); return { ok: mode !== 'rejected', json: async () => { if (mode === 'json') throw Error('invalid'); return mode === 'malformed' ? {} : { success: true }; } }; };
function reset(value) { mode = value; stamps = []; requests = []; release = undefined; }
const call = (row = appt) => m.exports.runCompletionEffects(db, row, shop, 'fixture');
(async () => {
  for (const failure of ['rejected', 'throw', 'json', 'malformed']) { reset(failure); await call(); assert.equal(stamps.length, 0, 'Unconfirmed review send must not stamp'); assert.equal(requests.filter(r => r.url === '/api/send-email').length, 1); }
  reset('success'); await call(); assert.equal(stamps.length, 1); assert.equal(stamps[0].table, 'appointments'); assert.ok(stamps[0].patch.review_request_sent_at); const send = requests.find(r => r.url === '/api/send-email'); assert.equal(send.init.headers.Authorization, 'Bearer fixture'); assert.equal(JSON.parse(send.init.body).data.appointmentId, 'appt'); assert.equal(requests.filter(r => r.url === '/api/loyalty/award').length, 1);
  reset('held'); let done = false; const pending = call().then(() => { done = true; }); for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof release, 'function'); assert.equal(stamps.length, 0); assert.equal(done, false); release(); await pending; assert.equal(stamps.length, 1);
  reset('success'); await call({ ...appt, review_request_sent_at: '2026-09-17T10:00:00Z' }); assert.equal(stamps.length, 0); assert.equal(requests.filter(r => r.url === '/api/send-email').length, 0);
  reset('success'); await call({ ...appt, client_email: null }); assert.equal(stamps.length, 0); assert.equal(requests.filter(r => r.url === '/api/send-email').length, 0);
  console.log('PASS calendar review: only confirmed successful response stamps, HTTP/network/JSON failures do not, awaiting, existing token/payload/loyalty/prior-send gates');
})().catch(error => { console.error(error); process.exitCode = 1; });
