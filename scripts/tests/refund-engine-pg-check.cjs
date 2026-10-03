// phase75 on a REAL PostgreSQL: a refunded visit puts its gift-card value back
// (once, under a lock — retries and double-fires are no-ops), refund records may
// say "gift_card", and refunding a gift-card sale zeroes + voids the card in one
// step so the same balance can never be refunded (or spent) twice.
const assert = require('node:assert/strict');
const path = require('node:path');
const { startPg, pgError, makeDb } = require('./helpers/real-pg.cjs');
const root = path.resolve(__dirname, '../..');
const SHOP = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const { psql, stop } = startPg();

(async () => {
  try {
    const schema = await psql(['-c', `
      create table public.shops (id uuid primary key);
      create table public.appointments (id uuid primary key, shop_id uuid references public.shops(id),
        status text, total_amount numeric, tip_amount numeric, payment_status text default 'pending',
        payment_method text check (payment_method = any (array['card','cash','online','gift_card'])),
        paid_at timestamptz, gift_applied numeric, balance_due numeric);
      create table public.gift_cards (id uuid primary key, shop_id uuid references public.shops(id), code text, initial_value numeric,
        remaining_value numeric, is_active boolean default true, redeemed_at timestamptz, created_at timestamptz default now());
      create table public.error_logs (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), level text, source text, message text, path text, shop_id uuid);
      create table public.transactions (id uuid primary key default gen_random_uuid(), shop_id uuid, amount numeric, source text,
        payment_method text, constraint transactions_payment_method_check check (payment_method = any (array['card','cash','online'])));
      create role service_role; create role anon; create role authenticated;
      grant usage on schema public to anon, authenticated;
      insert into public.shops values ('${SHOP}'), ('${OTHER}');`]);
    assert.equal(schema.code, 0, schema.err);
    for (const f of ['phase69_gift_card_ledger', 'phase70_gift_card_owner_adjust', 'phase71_gift_pay_appointment', 'phase75_refund_engine']) {
      const m = await psql(['-f', path.join(root, `supabase/migrations/${f}.sql`)]);
      assert.equal(m.code, 0, `${f}: ${m.err}`);
    }
    const one = async sql => { const r = await psql(['-c', sql]); assert.equal(r.code, 0, r.err); return r.out; };
    const bal = async id => Number(await one(`select remaining_value from public.gift_cards where id = '${id}'`));
    const active = async id => (await one(`select is_active from public.gift_cards where id = '${id}'`)) === 't';
    const consistent = async () => Number(await one(`select count(*) from public.gift_cards g where g.remaining_value <> g.initial_value + coalesce((select sum(amount) from public.gift_card_ledger l where l.gift_card_id = g.id), 0)`));
    const db = makeDb(psql, { setOfFns: ['gift_pay_appointment', 'gift_refund_sale', 'gift_adjust_manual'] });
    const pay = async (appt, code) => (await db.rpc('gift_pay_appointment', { p_shop_id: SHOP, p_appointment_id: appt, p_code: code })).data[0];
    const setPay = (id, s) => one(`update public.appointments set payment_status = '${s}' where id = '${id}'`);

    // 1) Refunding a gift-paid visit puts the value back; reinstating spends it again.
    const G1 = uuid(1), A1 = uuid(11);
    await one(`insert into public.gift_cards (id, shop_id, code, initial_value, remaining_value) values ('${G1}', '${SHOP}', 'JAKE-50', 50, 50)`);
    await one(`insert into public.appointments (id, shop_id, status, total_amount, tip_amount) values ('${A1}', '${SHOP}', 'confirmed', 40.25, 0)`);
    assert.equal((await pay(A1, 'JAKE-50')).applied, 40.25);
    assert.equal(await bal(G1), 9.75);
    await one(`update public.appointments set status = 'completed' where id = '${A1}'`);
    assert.equal(await bal(G1), 9.75, 'completing keeps it spent');
    await setPay(A1, 'refunded');
    assert.equal(await bal(G1), 50, 'refund → value back on the card');
    await setPay(A1, 'refunded'); await one(`update public.appointments set tip_amount = 0 where id = '${A1}'`);
    assert.equal(await bal(G1), 50, 'a repeat changes nothing');
    assert.equal(Number(await one(`select public.gift_sync_appointment('${A1}')`)), 0, 'a direct re-sync is a no-op');
    await setPay(A1, 'paid');
    assert.equal(await bal(G1), 9.75, 'undo the refund → spent again');
    await setPay(A1, 'refunded');
    assert.equal(await one(`select string_agg(action || ':' || amount, ',' order by created_at, action) from public.gift_card_ledger where appointment_id = '${A1}'`).then(s => s.split(',').sort().join(',')),
      ['reapplied:-40.25', 'redeemed:-40.25', 'restored:40.25', 'restored:40.25'].join(','));
    // A no-show keeps a gift payment unless it's refunded.
    const A2 = uuid(12);
    await one(`insert into public.appointments (id, shop_id, status, total_amount, tip_amount) values ('${A2}', '${SHOP}', 'confirmed', 9.75, 0)`);
    await pay(A2, 'JAKE-50'); assert.equal(await bal(G1), 40.25);
    await one(`update public.appointments set status = 'no-show' where id = '${A2}'`); assert.equal(await bal(G1), 40.25, 'no-show keeps it');
    await setPay(A2, 'refunded'); assert.equal(await bal(G1), 50, 'refunded no-show gives it back');
    assert.equal(await consistent(), 0, 'balance == value + sum(ledger)');

    // 2) Refund records can say "gift_card"; anything else is still rejected.
    await one(`insert into public.transactions (shop_id, amount, source, payment_method) values ('${SHOP}', -25, 'refund', 'gift_card')`);
    const bad = await psql(['-c', `insert into public.transactions (shop_id, amount, payment_method) values ('${SHOP}', 1, 'bitcoin')`]);
    assert.equal(pgError(bad.err).code, '23514');

    // 3) Refunding a gift-card sale: one locked step zeroes + voids the card and
    //    returns what to hand back. Two at once → exactly one gets the money.
    const G2 = uuid(2);
    await one(`insert into public.gift_cards (id, shop_id, code, initial_value, remaining_value) values ('${G2}', '${SHOP}', 'SALE-50', 50, 30)`);
    await one(`insert into public.gift_card_ledger (shop_id, gift_card_id, amount, action) values ('${SHOP}', '${G2}', -20, 'adjusted')`);
    const race = await Promise.all([1, 2, 3].map(() => db.rpc('gift_refund_sale', { p_shop_id: SHOP, p_gift_card_id: G2, p_note: 'refund', p_user_id: uuid(99) })));
    const got = race.map(r => r.data[0]).map(r => `${r.status}:${Number(r.refunded)}`).sort();
    assert.deepEqual(got, ['empty:0', 'empty:0', 'ok:30'], 'only one refund of the unused $30');
    assert.equal(await bal(G2), 0); assert.equal(await active(G2), false, 'card voided');
    assert.equal(await one(`select action || '|' || amount || '|' || note || '|' || created_by from public.gift_card_ledger where gift_card_id = '${G2}' and action = 'refunded'`), `refunded|-30.00|refund|${uuid(99)}`);
    // A voided, emptied card can't be spent.
    const A3 = uuid(13);
    await one(`insert into public.appointments (id, shop_id, status, total_amount, tip_amount) values ('${A3}', '${SHOP}', 'confirmed', 5, 0)`);
    assert.equal((await pay(A3, 'SALE-50')).status, 'card_empty');
    // Stripe failed → the owner correction puts the balance back (and reactivates).
    const back = await db.rpc('gift_adjust_manual', { p_shop_id: SHOP, p_gift_card_id: G2, p_delta: 30, p_note: 'Refund failed — balance put back', p_user_id: uuid(99) });
    assert.equal(back.data[0].status, 'ok'); assert.equal(await bal(G2), 30); assert.equal(await active(G2), true);
    // Another shop's card: not found. Server-only.
    assert.equal((await db.rpc('gift_refund_sale', { p_shop_id: OTHER, p_gift_card_id: G2, p_note: 'x', p_user_id: uuid(99) })).data[0].status, 'not_found');
    for (const role of ['anon', 'authenticated']) {
      const f = await psql(['-c', `set role ${role}; select * from public.gift_refund_sale('${SHOP}', '${G2}', 'x', null)`]);
      assert.equal(pgError(f.err).code, '42501', `${role} cannot call it`);
    }
    assert.equal(await consistent(), 0, 'still: balance == value + sum(ledger)');
    assert.equal(Number(await one(`select count(*) from public.error_logs`)), 0, 'no sync failures');

    const version = await one('show server_version');
    console.log(`PASS refund engine on real PostgreSQL ${version} (phase69/70/71/75): refunded gift visit gives its value back once (re-fires no-op, un-refund re-spends, refunded no-show too), "gift_card" refund records allowed, gift-card sale refund zeroes + voids in one locked step (3 at once → one refund), rollback restores, other shop / browser roles refused, balance == value + ledger`);
  } finally { stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
