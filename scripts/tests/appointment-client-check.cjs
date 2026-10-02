const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
const load = rel => { const f = path.join(root, rel), x = new Module(f, module); x.filename = f; x.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : req(id); x._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f); return x.exports; };
const { findAppointmentClient, exactIlike } = load('src/lib/appointment-client.ts');

// Saved clients: a walk-in with no contact, an emailed client, a phone-only client, and another shop's client.
const rows = [
  { id: 'walkin', shop_id: 'shop', email: null, phone: null },
  { id: 'emailed', shop_id: 'shop', email: 'Jo_Doe@x.com', phone: null },
  { id: 'phoned', shop_id: 'shop', email: null, phone: '5065550000' },
  { id: 'foreign', shop_id: 'other', email: 'jo_doe@x.com', phone: '5065550000' },
];
let lookups;
const db = { from(table) { assert.equal(table, 'clients'); const f = []; const q = {
  select() { return q; },
  eq(col, v) { f.push(r => r[col] === v); return q; },
  ilike(col, pat) { const re = new RegExp('^' + pat.replace(/\\([\\%_])|([%_])|([.*+?^${}()|[\]])/g, (m, esc, wild, meta) => esc ? '\\' + esc : wild ? (wild === '%' ? '.*' : '.') : '\\' + meta) + '$', 'i'); f.push(r => r[col] != null && re.test(r[col])); return q; },
  maybeSingle() { lookups.push(f.length); const hits = rows.filter(r => f.every(fn => fn(r))); return Promise.resolve({ data: hits.length === 1 ? hits[0] : null, error: null }); },
}; return q; } };
const find = async appt => { lookups = []; return (await findAppointmentClient(db, 'shop', appt, 'id'))?.id ?? null; };

(async () => {
  // The saved link wins — a walk-in with no email/phone is still found (the "Jake" bug).
  assert.equal(await find({ client_id: 'walkin' }), 'walkin');
  assert.equal(lookups.length, 1);
  // ...but only inside this shop: another shop's id never matches, and nothing else to go on → none.
  assert.equal(await find({ client_id: 'foreign' }), null);
  // Older bookings with no link: email (case-insensitive, wildcards literal), then phone.
  assert.equal(await find({ client_email: 'jo_doe@X.com' }), 'emailed');
  assert.equal(await find({ client_email: 'jo%@x.com' }), null, '% is not a wildcard');
  assert.equal(await find({ client_email: 'joXdoe@x.com' }), null, '_ is not a wildcard');
  assert.equal(await find({ client_email: 'nobody@x.com', client_phone: '5065550000' }), 'phoned', 'falls back to phone');
  // A stale/foreign link falls back to contact details in THIS shop.
  assert.equal(await find({ client_id: 'foreign', client_email: 'jo_doe@x.com' }), 'emailed');
  assert.equal(await find({}), null);
  assert.equal(exactIlike('a_b%c\\d'), 'a\\_b\\%c\\\\d');

  // Every completion path uses this one rule (points + visit/spend stats, browser and server).
  const src = f => fs.readFileSync(path.join(root, f), 'utf8');
  const server = src('src/lib/completion-server.ts'), browser = src('src/lib/appointment-actions.ts');
  assert.equal((server.match(/findAppointmentClient</g) ?? []).length, 2, 'server award + stats');
  assert.match(browser, /findAppointmentClient</);
  assert.doesNotMatch(server + browser, /\.eq\(matchField|\.ilike\("email", emailMatch\)/, 'no ad-hoc contact matching left');
  // The client is resolved before the award is claimed, so no-client visits stay retryable.
  assert.ok(server.indexOf('findAppointmentClient<{ id: string }>') < server.indexOf('.update({ loyalty_awarded: true })'));
  console.log('PASS appointment client: saved link first (walk-ins earn + count), shop-scoped, exact case-insensitive email then phone, one rule on every completion path, no-client visits left unclaimed');
})().catch(e => { console.error(e); process.exitCode = 1; });
