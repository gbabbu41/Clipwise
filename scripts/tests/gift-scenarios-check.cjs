// Every gift-card scenario, proven on a REAL PostgreSQL with the real migrations
// (phase69/70/71/75/76/77) and the real app math (owner decisions 2026-10-03):
//  · PAID card  → income when the card was sold; when used: tax + tip + barber %.
//  · FREE card  → a 100% promo: $0 income, $0 tax, $0 tip, no commission.
//  · any coverage (10% / 50% / 100%), the rest paid by cash balance, card on file
//    (balance) or an ONLINE card charge — the pieces always add up to exactly one
//    visit; the barber's own earnings always equal what Payroll pays.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { startPg, makeDb } = require('./helpers/real-pg.cjs');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(rel) {
  const f = path.join(root, rel), m = new Module(f, module); m.filename = f;
  m.require = id => id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : id.startsWith('./') ? load(path.relative(root, path.join(path.dirname(f), `${id}.ts`))) : req(id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
  return m.exports;
}
const rev = load('src/lib/revenue.ts'), be = load('src/lib/barber-earnings.ts');
const SHOP = '11111111-1111-4111-8111-111111111111', GILL = '22222222-2222-4222-8222-222222222222', SVC = '33333333-3333-4333-8333-333333333333';
let n = 100;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const c = v => Math.round(v * 100);
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
        payment_method text, payment_intent_id text, paid_at timestamptz, gift_applied numeric, balance_due numeric);
      create table public.gift_cards (id uuid primary key, shop_id uuid, code text, initial_value numeric, remaining_value numeric,
        is_active boolean default true, redeemed_at timestamptz, note text, created_at timestamptz default now());
      create table public.error_logs (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), level text, source text, message text, path text, shop_id uuid);
      create table public.transactions (id uuid primary key default gen_random_uuid(), shop_id uuid, barber_id uuid, appointment_id uuid,
        client_name text, service_name text, amount numeric, tip numeric, tax numeric, stripe_fee numeric, commission_amount numeric,
        payment_method text, type text, source text, payment_intent_id text, refunded boolean default false, created_at timestamptz default now(),
        constraint transactions_payment_method_check check (payment_method = any (array['card','cash','online'])));
      create role service_role; create role anon; create role authenticated; grant usage on schema public to anon, authenticated;
      insert into public.shops values ('${SHOP}'); insert into public.services values ('${SVC}', 'Skin Fade');`);
    for (const f of ['phase69_gift_card_ledger', 'phase70_gift_card_owner_adjust', 'phase71_gift_pay_appointment', 'phase75_refund_engine', 'phase76_gift_card_earnings']) {
      const r = await psql(['-f', path.join(root, `supabase/migrations/${f}.sql`)]); assert.equal(r.code, 0, `${f}: ${r.err}`);
    }
    // A free card already used BEFORE phase77 (phase76 wrongly paid the barber on it) → cleaned up.
    const OLD = uuid(), OLDCARD = uuid();
    await one(`insert into public.gift_cards (id, shop_id, code, initial_value, remaining_value, note) values ('${OLDCARD}', '${SHOP}', 'OLD-FREE', 50, 50, 'Complimentary')`);
    await one(`insert into public.appointments (id, shop_id, barber_id, service_id, client_name, status, total_amount, tax_amount, tip_amount) values ('${OLD}', '${SHOP}', '${GILL}', '${SVC}', 'Old', 'confirmed', 40.25, 5.25, 0)`);
    const db = makeDb(psql, { setOfFns: ['gift_pay_appointment', 'gift_redeem_for_appointment'] });
    await db.rpc('gift_pay_appointment', { p_shop_id: SHOP, p_appointment_id: OLD, p_code: 'OLD-FREE' });
    assert.equal((await rows(`select 1 from public.transactions where appointment_id = '${OLD}'`)).length, 1, 'phase76 wrote a line');
    const m77 = await psql(['-f', path.join(root, 'supabase/migrations/phase77_free_gift_cards.sql')]); assert.equal(m77.code, 0, m77.err);
    assert.equal((await rows(`select 1 from public.transactions where appointment_id = '${OLD}'`)).length, 0, 'phase77 removed the free-card line');
    assert.equal(await one(`select gift_free::text from public.appointments where id = '${OLD}'`), '40.25', 'and recorded the free part');
    assert.equal(await one(`select complimentary::text from public.gift_cards where id = '${OLDCARD}'`), 'true', 'backfilled from the note');

    const TOTAL = 40.25, TAX = 5.25, TIP = 5, BASE = TOTAL + TIP, SERVICE = TOTAL - TAX;
    const appt = async id => (await rows(`select id, total_amount::float, tax_amount::float, tip_amount::float, gift_applied::float, gift_free::float, balance_due::float, payment_status, payment_method, payment_intent_id, status, barber_id from public.appointments where id = '${id}'`))[0];
    const ledger = async id => rows(`select t.*, t.amount::float as amount, t.tax::float as tax, t.tip::float as tip, t.created_at::text as created_at from public.transactions t where appointment_id = '${id}'`);
    const card = async (free, value) => {
      const id = uuid(), code = `C${n}`;
      await one(`insert into public.gift_cards (id, shop_id, code, initial_value, remaining_value, complimentary) values ('${id}', '${SHOP}', '${code}', ${value}, ${value}, ${free})`);
      return code;
    };
    const results = [];

    for (const free of [false, true]) {
      for (const pct of [10, 50, 100]) {
        for (const rest of pct === 100 ? ['none'] : ['cash', 'card-on-file', 'online']) {
          const label = `${free ? 'FREE' : 'PAID'} card ${pct}% + ${rest}`;
          const A = uuid(), giftValue = Math.round(BASE * pct) / 100, code = await card(free, giftValue);
          let pi = null;
          if (rest === 'online') {
            // Online booking: inserted already paid; the card is drawn down after (finalize-booking-session).
            pi = `pi_${n}`;
            await one(`insert into public.appointments (id, shop_id, barber_id, service_id, client_name, status, total_amount, tax_amount, tip_amount, payment_status, payment_method, payment_intent_id, paid_at, gift_applied)
              values ('${A}', '${SHOP}', '${GILL}', '${SVC}', 'Jake', 'confirmed', ${TOTAL}, ${TAX}, ${TIP}, 'paid', 'card', '${pi}', now(), ${giftValue})`);
            const own = rev.restShare({ total_amount: TOTAL, tax_amount: TAX, tip_amount: TIP }, giftValue);
            await one(`insert into public.transactions (shop_id, barber_id, appointment_id, service_name, amount, tax, tip, payment_method, type, source, payment_intent_id)
              values ('${SHOP}', '${GILL}', '${A}', 'Skin Fade', ${own.service}, ${own.tax}, ${own.tip}, 'card', 'service', 'completion', '${pi}')`);
            await db.rpc('gift_redeem_for_appointment', { p_shop_id: SHOP, p_code: code, p_amount: giftValue, p_appointment_id: A, p_require_full: false });
          } else {
            // Checkout: gift card first, the rest (if any) collected as a balance.
            await one(`insert into public.appointments (id, shop_id, barber_id, service_id, client_name, status, total_amount, tax_amount, tip_amount)
              values ('${A}', '${SHOP}', '${GILL}', '${SVC}', 'Jake', 'confirmed', ${TOTAL}, ${TAX}, ${TIP})`);
            const r = (await db.rpc('gift_pay_appointment', { p_shop_id: SHOP, p_appointment_id: A, p_code: code })).data[0];
            assert.equal(r.status, 'ok', label);
            if (rest !== 'none') {
              const a = await appt(A);
              const share = rev.balanceShare(a, a.balance_due);   // as collect-balance / the balance link write it
              assert.equal(c(share.total), c(BASE - giftValue), `${label}: balance is the rest`);
              pi = rest === 'card-on-file' ? `pi_${n}` : null;
              await one(`insert into public.transactions (shop_id, barber_id, appointment_id, service_name, amount, tax, tip, payment_method, type, source, payment_intent_id)
                values ('${SHOP}', '${GILL}', '${A}', 'Skin Fade (balance)', ${share.service}, ${share.tax}, ${share.tip}, '${rest === 'cash' ? 'cash' : 'card'}', 'service', 'balance', ${pi ? `'${pi}'` : 'null'})`);
              await one(`update public.appointments set balance_due = 0 where id = '${A}'`);
            }
          }
          await one(`update public.appointments set status = 'completed' where id = '${A}'`);

          const a = await appt(A), txs = await ledger(A);
          // The pieces add up to exactly one visit (gift line / free part + the rest).
          const giftLine = txs.find(t => t.payment_method === 'gift_card');
          const restRow = txs.find(t => t.payment_method !== 'gift_card');
          const giftPart = free ? rev.freeGiftShare(a) : giftLine && { service: giftLine.amount, tax: giftLine.tax, tip: giftLine.tip };
          assert.equal(!!giftLine, !free, `${label}: barber gift line only for a PAID card`);
          assert.equal(c(a.gift_free), free ? c(giftValue) : 0, `${label}: free part recorded`);
          const sum = k => c((giftPart?.[k] ?? 0) + (restRow?.[k === 'service' ? 'amount' : k] ?? 0));
          assert.deepEqual([sum('service'), sum('tax'), sum('tip')], [c(SERVICE), c(TAX), c(TIP)], `${label}: pieces = one visit`);

          // Shop money: income = only what came in now (the gift card's value counted when SOLD, or never if free).
          const t = rev.collectedTotals([a], txs);
          const moneyIn = pct === 100 ? 0 : BASE - giftValue;
          const free$ = free ? rev.freeGiftShare(a) : { tax: 0, tip: 0, total: 0, service: 0 };
          assert.equal(c(t.gross), c(moneyIn), `${label}: income`);
          assert.equal(c(t.tax), c(TAX - free$.tax), `${label}: tax (free part has none)`);
          assert.equal(c(t.tips), c(TIP - free$.tip), `${label}: tips (free part has none)`);
          assert.equal(c(t.freeGifts), free ? c(giftValue) : 0, `${label}: promo value shown`);

          // Barber: their own screen == Payroll (commission basis), 50%.
          const portal = be.computeBarberEarnings(txs, 50);
          const payrollCommission = rev.apptServiceCollected(a) * 0.5;
          assert.equal(c(portal.commission), c(payrollCommission), `${label}: barber screen = Payroll (${portal.commission} vs ${payrollCommission})`);
          assert.equal(c(portal.tips), c(t.tips), `${label}: barber tips = shop tips owed`);
          assert.equal(c(payrollCommission), c((SERVICE - free$.service) * 0.5), `${label}: free part pays no commission`);
          results.push(`${label}: in $${(t.gross).toFixed(2)} · tax $${t.tax.toFixed(2)} · barber $${portal.youKeep.toFixed(2)}${free ? ` · promo $${t.freeGifts.toFixed(2)}` : ''}`);

          // Refund (the visit's payment_status → refunded): the gift value goes back on the card;
          // a PAID card's line is taken back once; a FREE card has nothing to take back.
          await one(`update public.appointments set payment_status = 'refunded' where id = '${A}'`);
          const after = await ledger(A);
          const back = after.filter(x => x.source === 'refund');
          assert.equal(back.length, free ? 0 : 1, `${label}: take-back only for a paid card`);
          assert.equal(Number(await one(`select remaining_value from public.gift_cards where code = '${code}'`)), giftValue, `${label}: value back on the card`);
          if (!free) assert.equal(c(be.computeBarberEarnings(after.filter(x => x.payment_method === 'gift_card'), 50).youKeep), 0, `${label}: gift cut taken back`);
        }
      }
    }

    // No-show / cancel with a free card: nothing ever reaches the barber; a paid card's
    // no-show keeps its line (money paid is split), a cancel takes it back.
    for (const [free, status, lines] of [[true, 'no-show', 0], [true, 'cancelled', 0], [false, 'no-show', 1], [false, 'cancelled', 2]]) {
      const A = uuid(), code = await card(free, 50);
      await one(`insert into public.appointments (id, shop_id, barber_id, service_id, client_name, status, total_amount, tax_amount, tip_amount) values ('${A}', '${SHOP}', '${GILL}', '${SVC}', 'Z', 'confirmed', ${TOTAL}, ${TAX}, 0)`);
      await db.rpc('gift_pay_appointment', { p_shop_id: SHOP, p_appointment_id: A, p_code: code });
      await one(`update public.appointments set status = '${status}' where id = '${A}'`);
      assert.equal((await ledger(A)).length, lines, `${free ? 'free' : 'paid'} ${status}`);
    }
    assert.equal(await one(`select count(*) from public.error_logs`), '0', 'no sync failures');

    // Wiring: the app splits the same way everywhere.
    const src = f => fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(src('src/lib/finalize-booking-session.ts'), /restShare\(/, 'online card line = the rest after the gift');
    assert.match(src('src/app/api/appointments/collect-balance/route.ts'), /balanceShare\(appt, balance\)/);
    assert.match(src('src/app/api/stripe/balance-link/route.ts'), /balanceShare\(appt, balance\)/);
    assert.match(src('src/app/api/webhooks/stripe/route.ts'), /amount: balService, tip: balTip, tax: balTax/);
    assert.match(src('src/app/api/gift-card/issue-cash/route.ts'), /complimentary: true/);
    for (const f of ['src/app/dashboard/page.tsx', 'src/app/dashboard/analytics/page.tsx', 'src/app/dashboard/payroll/page.tsx'])
      assert.match(src(f), /apptServiceCollected/, `${f}: the one commission basis`);

    const version = await one('show server_version');
    console.log(`PASS gift scenarios (real PostgreSQL ${version}): ${results.length} paid/free × 10/50/100% × cash / card-on-file / online — pieces = one visit, income / tax / tips / promo right, barber screen = Payroll, refund puts value back (paid card cut taken back), no-show/cancel, phase77 cleanup + backfill\n  ` + results.join('\n  '));
  } finally { stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
