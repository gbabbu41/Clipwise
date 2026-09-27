const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; new Function('require', 'module', 'exports', code)(name => mocks[name] ?? require(name), m, m.exports); return m.exports;
}
const identity = load('src/lib/client-identity.ts');
const { clientMatchesQuery } = load('src/lib/client-search.ts');
const a = { id: 'a', shop_id: 's', name: 'Original VIP', email: 'a@example.test', phone: '437-111-2222', loyalty_points: 423, tag: 'VIP' };
const b = { id: 'b', shop_id: 's', name: 'Other', email: 'b@example.test', phone: '506-111-2222', loyalty_points: 213, tag: 'Returning' };
const appointments = [
  { shop_id: 'other', client_id: 'a', client_name: 'Foreign', status: 'completed', total_amount: 999 },
  { client_id: 'foreign-id', client_name: 'Malformed link', client_email: a.email, status: 'completed', total_amount: 999 },
  { client_id: 'a', client_name: 'Old alias', client_email: b.email, client_phone: b.phone, date: '2026-01-01', status: 'completed', total_amount: 20 },
  { client_id: 'b', client_name: 'Other old alias', client_email: a.email, client_phone: a.phone, date: '2026-01-02', status: 'completed', total_amount: 30 },
  { client_id: 'a', client_name: a.name, client_email: a.email, status: 'cancelled', total_amount: 40 },
];
for (const points of [423, 0]) {
  const result = identity.groupClients({ shopId: 's', clientRows: [{ ...a, loyalty_points: points }, b, { ...a, id: 'foreign', shop_id: 'other' }], apptRows: appointments });
  assert.equal(result.length, 2);
  const vip = result.find(c => c.id === 'a');
  assert.equal(vip.name, a.name); assert.equal(vip.tag, 'VIP'); assert.equal(vip.loyalty_points, points);
  assert.equal(vip.total_visits, 1); assert.equal(vip.total_spent, 20);
  assert.equal(result.find(c => c.id === 'b').total_spent, 30);
  assert.ok(clientMatchesQuery(vip, 'old alias')); assert.ok(clientMatchesQuery(vip, '506111'));
}
assert.equal(identity.sameIdentity(identity.clientToId(a), identity.apptToId(appointments[3])), false);
assert.equal(identity.sameIdentity(identity.clientToId(a), identity.apptToId(appointments[2])), true);
assert.deepEqual(identity.identityCandidates([a], { email: 'new@example.test', phone: a.phone }), []);
assert.deepEqual(identity.identityCandidates([a], { email: ' A@EXAMPLE.TEST ' }), [a]);
assert.deepEqual(identity.identityCandidates([a], { phone: '+1 (437) 111-2222' }), [a]);
assert.deepEqual(identity.identityCandidates([a], { name: a.name }), []);
function database(initial) {
  const rows = initial.map(x => ({ ...x })); let fail = false, inserts = 0;
  const db = { from(table) {
    assert.equal(table, 'clients'); let filters = [], inserted, updated, single = false;
    const q = { select: () => q, eq: (k, v) => { filters.push(r => (k === 'phone_normalized' ? identity.normPhone(r.phone) : r[k]) === v); return q; },
      ilike: (k, v) => { const literal = v.replace(/\\([\\%_])/g, '$1').toLowerCase(); filters.push(r => (r[k] ?? '').toLowerCase() === literal); return q; },
      update: value => { updated = value; return q; }, insert: value => { inserted = value; return q; }, single: () => { single = true; return q; }, maybeSingle: () => { single = true; return q; },
      then(resolve, reject) { if (fail) return Promise.resolve({ data: null, error: { message: 'offline' } }).then(resolve, reject);
        if (inserted) { const row = { ...inserted, id: 'new-' + ++inserts }; rows.push(row); return Promise.resolve({ data: row, error: null }).then(resolve, reject); }
        const found = rows.filter(r => filters.every(f => f(r))); if (updated) found.forEach(row => Object.assign(row, updated)); return Promise.resolve({ data: single ? found[0] ?? null : found, error: null }).then(resolve, reject); }
    }; return q;
  } };
  return { db, rows, get inserts() { return inserts; }, setFail() { fail = true; } };
}
(async () => {
  const d = database([a, b]);
  const resolver = load('src/lib/ensure-client.ts', { '@/lib/supabase-admin': { supabaseAdmin: d.db }, '@/lib/client-identity': identity });
  assert.equal(await resolver.ensureClientRow('s', { name: 'Updated', email: ' A@EXAMPLE.TEST ' }), 'a');
  assert.equal(d.inserts, 0);
  const id = await resolver.ensureClientRow('s', { name: 'Family', email: 'family@example.test', phone: a.phone });
  assert.equal(id, 'new-1'); assert.equal(await resolver.ensureClientRow('s', { name: 'Family', email: 'FAMILY@example.test', phone: a.phone }), id);
  assert.equal(d.inserts, 1);
  await assert.rejects(resolver.findExistingClient('s', { phone: a.phone }), /More than one/);
  assert.equal(await resolver.findExistingClient('other', { email: a.email }), null);
  const allowed = load('src/app/api/clients/create/route.ts', { 'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } }, '@/lib/supabase-admin': { supabaseAdmin: d.db }, '@/lib/api-auth': { authorizeShop: async () => ({ user: { id: 'owner' } }) }, '@/lib/rate-limit': { enforceRateLimit: () => null }, '@/lib/ensure-client': resolver });
  const add = body => allowed.POST({ json: async () => ({ shop_id: 's', ...body }) });
  const duplicate = await add({ name: 'Repeat', email: a.email.toUpperCase() });
  assert.equal(duplicate.body.id, 'a'); assert.equal(duplicate.body.duplicate, true); assert.equal(duplicate.body.client.name, a.name);
  assert.equal((await add({ name: 'Family', phone: a.phone })).status, 409); assert.equal(d.inserts, 1);
  const added = await add({ name: 'New', email: 'created@example.test' }); assert.equal(added.body.duplicate, false); assert.equal(d.inserts, 2);
  const pos = load('src/lib/clients-server.ts', { '@/lib/supabase-admin': { supabaseAdmin: d.db }, '@/lib/ensure-client': resolver });
  await pos.upsertClient('s', 'Original VIP', a.email.toUpperCase(), a.phone, 10);
  assert.equal(d.rows.find(r => r.id === 'a').total_spent, 10);
  assert.equal(d.rows.find(r => r.id === 'a').loyalty_points, 423);
  assert.equal(d.rows.find(r => r.id === 'b').total_spent, undefined); assert.equal(d.inserts, 2);
  d.setFail(); assert.equal(await resolver.ensureClientRow('s', { name: 'Offline', email: 'new@test' }), null); assert.equal(d.inserts, 2);
  const route = load('src/app/api/clients/create/route.ts', { 'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } }, '@/lib/supabase-admin': { supabaseAdmin: d.db }, '@/lib/api-auth': { authorizeShop: async () => ({ error: { status: 403 } }) }, '@/lib/rate-limit': { enforceRateLimit: () => null }, '@/lib/ensure-client': resolver });
  assert.equal((await route.POST({ json: async () => ({ shop_id: 'other', name: 'Forged', email: a.email }) })).status, 403);
  assert.equal(d.inserts, 2);
  console.log('PASS client identity: immutable saved IDs, isolated history/points/VIP, aliases, cancellation, family phones, normalized repeats, ambiguous/error safe failure and tenant gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
