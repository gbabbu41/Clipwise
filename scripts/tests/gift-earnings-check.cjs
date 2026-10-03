// Barbers earn on gift-card visits (owner decision 2026-10-03) — and the shop's
// money stays exactly as it was: a gift card's value counted when the card was
// SOLD. Proven on a REAL PostgreSQL with phase69/70/71/75/76 + the real app math.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { startPg, makeDb } = require('./helpers/real-pg.cjs');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(rel, mocks = {}) {
  const f = path.join(root, rel), m = new Module(f, module); m.filename = f;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : id.startsWith('./') ? load(path.relative(root, path.join(path.dirname(f), `${id}.ts`)), mocks) : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
  return m.exports;
}
const SHOP = '11111111-1111-4111-8111-111111111111', GILL = '22222222-2222-4222-8222-222222222222', SVC = '33333333-3333-4333-8333-333333333333';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const { psql, stop } = startPg();

(async () => {
  try {
    const one = async sql => { const r = await psql(['-c', sql]); assert.equal(r.code, 0, r.err); return r.out; };
    const rows = async sql => JSON.parse(await one(`select coalesce(json_agg(t), '[]') from (${sql}) t`));
    await one(`
      create table public.shops (id uuid primary key);
      create table public.services (id uuid primary key, name text);
      create table public.appointments (id uuid primary key, shop_id uuid, barber_id uuid, service_id uuid, client_name text,
        status text, total_amount numeric, tax_amount numeric, tip_amount numeric, payment_status text default 'pending',
        payment_method text, paid_at timestamptz, gift_applied numeric, balance_due numeric);
      create table public.gift_cards (id uuid primary key, shop_id uuid, code text, initial_value numeric, remaining_value numeric,
        is_active boolean default true, redeemed_at timestamptz, created_at timestamptz default now());
      create table public.error_logs (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), level text, source text, message text, path text, shop_id uuid);
      create table public.transactions (id uuid primary key default gen_random_uuid(), shop_id uuid, barber_id uuid, appointment_id uuid,
        client_name text, service_name text, amount numeric, tip numeric, tax numeric, stripe_fee numeric, commission_amount numeric,
        payment_method text, type text check (type = any (array['service','product','tip'])), source text, payment_intent_id text,
        refunded boolean default false, created_at timestamptz default now(),
        constraint transactions_payment_method_check check (payment_method = any (array['card','cash','online'])));
      create role service_role; create role anon; create role authenticated; grant usage on schema public to anon, authenticated;
      insert into public.shops values ('${SHOP}'); insert into public.services values ('${SVC}', 'Skin Fade');`);
    const apply = async f => { const r = await psql(['-f', path.join(root, `supabase/migrations/${f}.sql`)]); assert.equal(r.code, 0, `${f}: ${r.err}`); };
    for (const f of ['phase69_gift_card_ledger', 'phase70_gift_card_owner_adjust', 'phase71_gift_pay_appointment', 'phase75_refund_engine']) await apply(f);

    const db = makeDb(psql, { setOfFns: ['gift_pay_appointment'] });
    const card = (id, code, v) => one(`insert into public.gift_cards (id, shop_id, code, initial_value, remaining_value) values ('${id}', '${SHOP}', '${code}', ${v}, ${v})`);
    const visit = (id, total, tax, tip, status = 'confirmed') => one(`insert into public.appointments (id, shop_id, barber_id, service_id, client_name, status, total_amount, tax_amount, tip_amount)
      values ('${id}', '${SHOP}', '${GILL}', '${SVC}', 'Jake', '${status}', ${total}, ${tax}, ${tip})`);
    const pay = async (id, code) => (await db.rpc('gift_pay_appointment', { p_shop_id: SHOP, p_appointment_id: id, p_code: code })).data[0];
    const lines = id => rows(`select source, payment_method, amount::float, tax::float, tip::float, refunded, service_name, barber_id from public.transactions where appointment_id = '${id}' order by source`);

    // Before phase76: a gift visit already paid + completed (backfilled below).
    const A0 = uuid(10), G0 = uuid(1);
    await card(G0, 'OLD-50', 50); await visit(A0, 40.25, 5.25, 0);
    await pay(A0, 'OLD-50'); await one(`update public.appointments set status = 'completed' where id = '${A0}'`);
    assert.equal((await lines(A0)).length, 0, 'nothing before phase76');
    await apply('phase76_gift_card_earnings');
    assert.deepEqual(await lines(A0), [{ source: 'completion', payment_method: 'gift_card', amount: 35, tax: 5.25, tip: 0, refunded: false, service_name: 'Skin Fade', barber_id: GILL }], 'backfilled');

    // 1. Paid by gift card (checkout) → ONE earnings line, dated when paid; tax + tip share.
    const A1 = uuid(11), G1 = uuid(2);
    await card(G1, 'JAKE-60', 60); await visit(A1, 40.25, 5.25, 5);
    await pay(A1, 'JAKE-60');
    assert.deepEqual((await lines(A1)).map(l => [l.source, l.amount, l.tax, l.tip]), [['completion', 35, 5.25, 5]]);
    assert.equal(await one(`select (t.created_at = a.paid_at)::text from public.transactions t join public.appointments a on a.id = t.appointment_id where t.appointment_id = '${A1}'`), 'true', 'dated when paid');
    await one(`update public.appointments set status = 'completed' where id = '${A1}'`);
    await pay(A1, 'JAKE-60');
    assert.equal((await lines(A1)).length, 1, 'completing / retrying never adds a second line');

    // 2. Split: $25 gift + the rest later → the line covers the GIFT part only (the rest has its own line).
    const A2 = uuid(12), G2 = uuid(3);
    await card(G2, 'PART-25', 25); await visit(A2, 40.25, 5.25, 5);
    const p2 = await pay(A2, 'PART-25'); assert.equal(Number(p2.applied), 25); assert.equal(Number(p2.balance_due), 20.25);
    const l2 = (await lines(A2))[0];
    assert.deepEqual([l2.amount + l2.tax + l2.tip, l2.tax, l2.tip], [25, 2.9, 2.76], 'gift share of service / tax / tip');

    // 3. Cancelled → value back on the card + the cut taken back, once; the line is marked refunded.
    await one(`update public.appointments set status = 'cancelled' where id = '${A2}'`);
    await one(`update public.appointments set status = 'cancelled', tip_amount = 5 where id = '${A2}'`);
    const after = await lines(A2);
    assert.deepEqual(after.map(l => [l.source, l.payment_method, Math.round((l.amount + l.tax + l.tip) * 100)]), [['completion', 'gift_card', 2500], ['refund', 'gift_card', -2500]]);
    assert.equal(after[0].refunded, true); assert.equal(after[1].service_name, 'Refund — Skin Fade (back on gift card)');
    assert.equal(Number(await one(`select remaining_value from public.gift_cards where id = '${G2}'`)), 25, 'value back on the card');

    // 4. Refunded (the app's refund engine) → the same take-back line, under the SAME id the app uses.
    await one(`update public.appointments set payment_status = 'refunded' where id = '${A1}'`);
    assert.equal((await lines(A1)).filter(l => l.source === 'refund').length, 1);
    const { refundRecordId } = load('src/lib/refund-ledger.ts', { '@/lib/supabase-admin': { supabaseAdmin: {} }, '@/lib/ledger-log': { logLedgerSaveFailure: async () => {} } });
    assert.equal(await one(`select public.clipwise_ledger_id('gift:${A1}')::text`), refundRecordId(`gift:${A1}`), 'database and app agree on the id → never both');
    assert.equal(await one(`select count(*) from public.transactions where id = '${refundRecordId(`gift:${A1}`)}'`), '1');
    // A later cancel of that refunded visit adds nothing.
    await one(`update public.appointments set status = 'cancelled' where id = '${A1}'`);
    assert.equal((await lines(A1)).length, 2);

    // 5. No-show keeps the gift value → keeps its line (like a prepaid card).
    const A3 = uuid(13), G3 = uuid(4);
    await card(G3, 'NS-50', 50); await visit(A3, 40.25, 5.25, 0); await pay(A3, 'NS-50');
    await one(`update public.appointments set status = 'no-show' where id = '${A3}'`);
    assert.deepEqual((await lines(A3)).map(l => l.source), ['completion']);

    // 6. Booking prepaid by gift card (book/in-person: tax set BEFORE paid) → tax share right.
    const A4 = uuid(14), G4 = uuid(5);
    await card(G4, 'PRE-50', 50);
    await one(`insert into public.appointments (id, shop_id, barber_id, service_id, client_name, status, total_amount, tip_amount) values ('${A4}', '${SHOP}', '${GILL}', '${SVC}', 'Pre', 'confirmed', 35, 0)`);
    await one(`select * from public.gift_redeem_for_appointment('${SHOP}', 'PRE-50', 40.25, '${A4}', true)`);
    await one(`update public.appointments set tax_amount = 5.25 where id = '${A4}'`);
    await one(`update public.appointments set payment_method = 'gift_card', gift_applied = 40.25 where id = '${A4}'`);
    await one(`update public.appointments set total_amount = 40.25, payment_status = 'paid', paid_at = now() where id = '${A4}'`);
    assert.deepEqual((await lines(A4)).map(l => [l.amount, l.tax]), [[35, 5.25]]);
    const inPerson = fs.readFileSync(path.join(root, 'src/app/api/book/in-person/route.ts'), 'utf8');
    assert(inPerson.indexOf('.update({ tax_amount: taxAmt })') < inPerson.indexOf('payment_status: "paid", paid_at'), 'in-person: tax saved before the booking turns paid');

    // 7. Not paid by gift card → nothing. No sync failures.
    const A5 = uuid(15); await visit(A5, 30, 0, 0); await one(`update public.appointments set payment_status = 'paid', status = 'completed' where id = '${A5}'`);
    assert.equal((await lines(A5)).length, 0);
    assert.equal(await one(`select count(*) from public.error_logs`), '0');
    for (const role of ['anon', 'authenticated']) {
      const f = await psql(['-c', `set role ${role}; select public.gift_earning_sync('${A1}')`]);
      assert.match(f.err, /permission denied/, `${role} cannot call it`);
    }

    // 8. The math: the barber sees it, the shop's money doesn't move.
    const rev = load('src/lib/revenue.ts');
    const be = load('src/lib/barber-earnings.ts');
    const all = (await rows(`select t.*, t.amount::float as amount, t.tax::float as tax, t.tip::float as tip, t.created_at::text as created_at from public.transactions t where appointment_id = '${A1}'`));
    const earn = all.find(t => t.source === 'completion'), back = all.find(t => t.source === 'refund');
    const appt = { id: A1, client_name: 'Jake', total_amount: 40.25, tax_amount: 5.25, tip_amount: 5, gift_applied: 45.25, balance_due: 0, payment_status: 'paid', payment_method: 'gift_card', status: 'completed' };
    const without = rev.collectedTotals([appt], []), withLine = rev.collectedTotals([appt], [earn]);
    assert.deepEqual([withLine.gross, withLine.net, withLine.tips, withLine.tax, withLine.cash], [without.gross, without.net, without.tips, without.tax, without.cash], 'the earnings line adds NO shop money');
    assert.equal(rev.countablePosTxs([appt], [earn]).length, 0, 'never a POS sale');
    let e = be.computeBarberEarnings([earn].filter(be.isBarberLedgerRow), 50);
    assert.deepEqual([e.commission, e.tips, e.youKeep, e.count], [17.5, 5, 22.5, 1], 'Gill sees 50% of $35 + the $5 tip');
    e = be.computeBarberEarnings([earn, back].filter(be.isBarberLedgerRow), 50);
    assert.equal(Math.round(e.youKeep * 100), 0, 'refunded → taken back');
    assert.equal(be.computeBarberEarnings([earn], 0, true).youKeep, 40, 'owner chair keeps 100% + tip');
    // Shop money after the refund: only the tax/tip share comes back (no money out).
    const shop = rev.collectedTotals([{ ...appt, payment_status: 'refunded' }], [earn, back]);
    assert.deepEqual([shop.gross, shop.refunds, Math.round(shop.tax * 100), Math.round(shop.tips * 100)], [0, 0, 0, 0]);

    const version = await one('show server_version');
    console.log(`PASS gift-card earnings (real PostgreSQL ${version} + phase69/70/71/75/76): paid by gift card → one barber earnings line (gift share of service/tax/tip, dated when paid; split visits only the gift part; prepaid bookings too), cancel / refund → taken back once under the app's own id, no-show keeps it, existing visits backfilled, server-only, no failures — barber sees 50% + tip, shop money unchanged`);
  } finally { stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
