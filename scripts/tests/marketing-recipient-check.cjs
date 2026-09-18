const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), appReq = Module.createRequire(path.join(root, 'package.json'));
const ts = appReq('typescript'), { NextRequest } = appReq('next/server');
let rows, sends, queries, writes, failed, providerFailure, actor, plan;
function reset() {
  rows = [{ id: 'client', shop_id: 'shop', email: 'Saved@example.invalid', name: 'Saved Name', phone_normalized: '15555550100', promo_consent_status: 'granted' }];
  sends = []; queries = []; writes = []; failed = ''; providerFailure = false; actor = 'owner'; plan = 'pro';
}
const db = { auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: actor } : null } }) }, from(table) {
  const filters = []; let values, single = false;
  const q = { select() { return q; }, eq(k,v) { filters.push([k,v]); return q; }, ilike(k,v) { filters.push([k,v,'ilike']); return q; },
    limit() { return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; }, insert(v) { values = v; return q; },
    then(resolve,reject) { return Promise.resolve().then(() => {
      queries.push({ table, filters });
      if (values) { writes.push({ table, values }); return { data: table === 'clients' ? { id: 'created', ...values } : null, error: null }; }
      if (table === 'shops') return { data: { id: 'shop', owner_id: 'owner', name: 'Shop', email: 'shop@example.invalid', slug: 'shop', subscription_plan: plan, subscription_status: 'active' }, error: null };
      assert.equal(table, 'clients'); assert.ok(filters.some(([k,v]) => k === 'shop_id' && v === 'shop'));
      if (filters.some(([k]) => k === failed)) return { data: null, error: { message: 'private error' } };
      const found = rows.filter(row => filters.every(([k,v,op]) => op === 'ilike' ? row[k]?.toLowerCase() === v.replace(/\\([\\%_])/g, '$1').toLowerCase() : row[k] === v));
      return { data: single ? found[0] ?? null : found, error: null };
    }).then(resolve,reject); } }; return q;
} };
const mocks = { '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/emailer': { sendAppEmail: async (type,data) => { sends.push({type,data}); return providerFailure ? { error: 'rejected' } : { success: true }; } },
  '@/lib/validation': { effectivePlan: p => p, isPaidPlan: p => p === 'pro' }, '@/lib/plans-server': { ensurePlansHydrated: async () => {} }, '@/lib/rate-limit': { enforceRateLimit: () => null },
  '@/lib/client-identity': { normPhone: p => p.replace(/\D/g, '') } };
function load(relative) {
  const file = path.join(root,relative), m = new Module(file,module);
  m.require = id => id === '@/lib/consent' ? load('src/lib/consent-rules.ts') : mocks[id] ?? appReq(id);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,file); return m.exports;
}
const { POST } = load('src/app/api/marketing/send/route.ts');
const call = async (recipient = { clientId: 'client', email: 'saved@example.invalid' }, token = 'valid') => {
  const res = await POST(new NextRequest('https://clipwise.ca/api/marketing/send', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ shop_id: 'shop', subject: 'Campaign', body: 'Hi {name}', recipients: [recipient] }) }));
  return { status: res.status, body: await res.json() };
};
(async () => {
  process.env.RESEND_API_KEY = 'dummy';
  reset(); const forged = await call({ clientId: 'client', email: 'victim@example.invalid' });
  assert.equal(sends.length,0,'consenting client ID must not authorize a different email'); assert.equal(forged.body.skipped,1);
  for (const recipient of [{ clientId:'client',email:'saved@example.invalid' }, { email:'SAVED@example.invalid' }, { clientId:'synthetic:booking',email:'saved@example.invalid' }]) {
    reset(); const r = await call(recipient); assert.equal(r.body.sent,1); assert.equal(sends[0].data.to,'Saved@example.invalid'); assert.match(sends[0].data.htmlBody,/Hi Saved Name/); assert.match(sends[0].data.htmlBody,/unsubscribe\?c=client/);
  }
  for (const clientId of ['foreign','missing']) { reset(); const r = await call({clientId,email:'saved@example.invalid'}); assert.equal(r.body.sent,0); assert.equal(sends.length,0); assert.equal(writes.length,0); }
  reset(); rows[0].shop_id='foreign'; assert.equal((await call()).body.sent,0); assert.equal(sends.length,0);
  for (const status of ['withdrawn',null]) { reset(); rows[0].promo_consent_status=status; assert.equal((await call()).body.sent,0); }
  reset(); rows[0].promo_consent_status=null; rows[0].last_visit=new Date().toISOString().slice(0,10); assert.equal((await call()).body.sent,1);
  reset(); rows[0].promo_consent_status='withdrawn'; rows[0].last_visit=new Date().toISOString().slice(0,10); assert.equal((await call()).body.sent,0);
  for (const [key,recipient] of [['id',{clientId:'client',email:'saved@example.invalid'}],['email',{email:'saved@example.invalid'}],['phone_normalized',{email:'new@example.invalid',phone:'+1 5555550100'}]]) {
    reset(); failed=key; assert.equal((await call(recipient)).body.sent,0); assert.equal(sends.length,0); assert.equal(writes.length,0);
  }
  reset(); assert.equal((await call({email:'victim@example.invalid',phone:'+1 5555550100'})).body.sent,0); assert.equal(writes.length,0);
  reset(); rows=[]; assert.equal((await call({email:'new@example.invalid'})).body.sent,0); assert.equal(writes[0].table,'clients');
  reset(); rows[0].email='a_b%test@example.invalid'; assert.equal((await call({email:'a_b%test@example.invalid'})).body.sent,1); assert.ok(queries.some(q=>q.filters.some(([k,v])=>k==='email'&&v==='a\\_b\\%test@example.invalid')));
  reset(); providerFailure=true; assert.equal((await call()).body.sent,0); assert.equal(writes.length,0);
  for (const email of [null,'','bad-address','a@example.invalid,b@example.invalid',[]]) { reset(); assert.equal((await call({clientId:'client',email})).body.sent,0); assert.equal(sends.length,0); }
  reset(); rows[0].email=null; assert.equal((await call()).body.sent,0); assert.equal(sends.length,0);
  reset(); rows[0].email=' Saved@example.invalid '; assert.equal((await call({email:'saved@example.invalid',phone:'+1 5555550100'})).body.sent,1); assert.equal(sends[0].data.to,'Saved@example.invalid');
  reset(); actor='foreign'; assert.equal((await call()).status,403); assert.equal(sends.length,0);
  reset(); plan='starter'; assert.equal((await call()).status,403); assert.equal(sends.length,0);
  reset(); assert.equal((await call(undefined,'')).status,401); assert.equal(sends.length,0);
  console.log('PASS campaign recipients: canonical consent-bound identity, forged/foreign/failed reads rejected, saved casing/name, synthetic/email lookup, opt-out/implied eligibility and delivery counts');
})().catch(e=>{console.error(e);process.exitCode=1;});
