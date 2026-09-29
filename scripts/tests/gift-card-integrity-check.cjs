// Gift-card money can't be lost or double-spent — proven against a REAL
// PostgreSQL with the real phase69 migration and the real app code.
// Incident (2026-09-28): a booking paid by gift card recorded no link to the card,
// so cancelling it could never give the value back; the POS read-modify-wrote the
// balance; a failed redemption left a "confirmed" booking silently unpaid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { startPg, pgError, makeDb } = require('./helpers/real-pg.cjs');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}

const SHOP = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const { psql, stop } = startPg();

(async () => {
  try {
    const schema = await psql(['-c', `
      create table public.shops (id uuid primary key);
      create table public.appointments (id uuid primary key, shop_id uuid references public.shops(id),
        status text check (status = any (array['pending','confirmed','completed','cancelled','no-show'])));
      create table public.gift_cards (id uuid primary key, shop_id uuid references public.shops(id), code text, initial_value numeric,
        remaining_value numeric, is_active boolean default true, redeemed_at timestamptz, created_at timestamptz default now());
      create table public.error_logs (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), level text, source text, message text, path text, shop_id uuid);
      create role service_role; create role anon; create role authenticated;
      grant usage on schema public to anon, authenticated;
      grant select, insert, update, delete on public.gift_cards to anon, authenticated;   -- Supabase's default grants
      insert into public.shops values ('${SHOP}'), ('${OTHER}');`]);
    assert.equal(schema.code, 0, schema.err);
    const mig = await psql(['-f', path.join(root, 'supabase/migrations/phase69_gift_card_ledger.sql')]);
    assert.equal(mig.code, 0, mig.err);
    const mig70 = await psql(['-f', path.join(root, 'supabase/migrations/phase70_gift_card_owner_adjust.sql')]);
    assert.equal(mig70.code, 0, mig70.err);

    const one = async sql => { const r = await psql(['-c', sql]); assert.equal(r.code, 0, r.err); return r.out; };
    const card = async (id, code, value, shop = SHOP) => one(`insert into public.gift_cards (id, shop_id, code, initial_value, remaining_value) values ('${id}', '${shop}', '${code}', ${value}, ${value})`);
    const bal = async id => Number(await one(`select remaining_value from public.gift_cards where id = '${id}'`));
    const active = async id => (await one(`select is_active from public.gift_cards where id = '${id}'`)) === 't';
    const booking = async (id, status = 'confirmed') => one(`insert into public.appointments values ('${id}', '${SHOP}', '${status}')`);
    const setStatus = (id, status) => one(`update public.appointments set status = '${status}' where id = '${id}'`);
    const consistent = async () => Number(await one(`select count(*) from public.gift_cards g where g.remaining_value <> g.initial_value + coalesce((select sum(amount) from public.gift_card_ledger l where l.gift_card_id = g.id), 0)`));

    const db = makeDb(psql, { setOfFns: ['gift_adjust', 'gift_redeem_for_appointment', 'gift_adjust_manual'] });
    const { redeemGiftForBooking, redeemGiftCard, findRedeemableGift } = load('src/lib/gift-redeem.ts', { '@/lib/supabase-admin': { supabaseAdmin: db } });
    const pay = (appointmentId, amount, code = 'PNWT-6TR3-B2ZZ', requireFull = true) =>
      redeemGiftForBooking({ shopId: SHOP, code, amount, appointmentId, requireFull });

    // 1. The incident: $50 card pays a $40.25 booking in full, then the booking is
    //    cancelled (any path — a plain UPDATE, like the owner's calendar).
    const G = uuid(1), A = uuid(101);
    await card(G, 'PNWT-6TR3-B2ZZ', 50);
    await booking(A);
    assert.deepEqual(await pay(A, 40.25, ' pnwt-6tr3-b2zz '), { applied: 40.25, balance: 9.75 }, 'code is normalised; balance returned for the receipt');
    assert.equal(await bal(G), 9.75);
    assert.deepEqual(await pay(A, 40.25), { applied: 0, balance: 9.75 }, 'a retry for the same booking never spends twice');
    await setStatus(A, 'cancelled');
    assert.equal(await bal(G), 50, 'cancelled booking gives the value back to the card');
    await setStatus(A, 'confirmed');
    assert.equal(await bal(G), 9.75, 'reinstated → spent again');
    await setStatus(A, 'completed');
    assert.equal(await bal(G), 9.75);

    // 2. A no-show keeps the value (like a prepaid card payment).
    const G2 = uuid(2), B = uuid(102);
    await card(G2, 'NOSHOW-1', 40);
    await booking(B);
    await pay(B, 40, 'NOSHOW-1');
    await setStatus(B, 'no-show');
    assert.equal(await bal(G2), 0);
    assert.equal(await active(G2), false, 'an emptied card is inactive');
    await setStatus(B, 'cancelled');   // owner corrects no-show → cancelled: value back, card usable again
    assert.equal(await bal(G2), 40);
    assert.equal(await active(G2), true);

    // 3. All-or-nothing: a card that can't cover the bill spends NOTHING.
    const C = uuid(103);
    await booking(C);
    assert.equal((await pay(C, 45)).applied, 0);
    assert.equal(await bal(G), 9.75);
    //    A cancelled booking can't spend a card; an unknown / other-shop code spends nothing.
    const D = uuid(104);
    await booking(D, 'cancelled');
    assert.equal((await pay(D, 5)).applied, 0);
    await card(uuid(3), 'OTHERSHOP', 100, OTHER);
    assert.equal((await pay(uuid(105), 5, 'OTHERSHOP')).applied, 0);
    assert.equal(await findRedeemableGift(SHOP, 'OTHERSHOP'), null);

    // 4. A card the owner deactivated can't be spent, and a give-back doesn't re-open it.
    const G4 = uuid(4), E = uuid(106);
    await card(G4, 'OWNER-OFF', 60);
    await booking(E);
    await pay(E, 20, 'OWNER-OFF');
    await one(`update public.gift_cards set is_active = false where id = '${G4}'`);
    assert.equal((await pay(uuid(107), 5, 'OWNER-OFF')).applied, 0);
    await setStatus(E, 'cancelled');
    assert.equal(await bal(G4), 60);
    assert.equal(await active(G4), false, 'owner deactivation respected');
    //    A give-back never lifts a card above its original value.
    assert.equal(Number(JSON.parse(await one(`select json_agg(t) from public.gift_adjust('${SHOP}', '${G4}', 25, 'restored') t`))[0].applied), 0);

    // 5. Real races (separate connections).
    //    a) two bookings grab the same $50 card at once, each needing $30 → exactly one pays.
    const G5 = uuid(5);
    await card(G5, 'RACE-50', 50);
    const R1 = uuid(108), R2 = uuid(109);
    await booking(R1); await booking(R2);
    const race = await Promise.all([pay(R1, 30, 'RACE-50'), pay(R2, 30, 'RACE-50')]);
    assert.deepEqual(race.map(r => r.applied).sort(), [0, 30]);
    assert.equal(await bal(G5), 20);
    //    b) two POS sales take $40 each from a $50 card at once → $50 spent, never $80.
    const G6 = uuid(6);
    await card(G6, 'POS-50', 50);
    const pos = await Promise.all([redeemGiftCard({ shopId: SHOP, giftCardId: G6, amount: 40 }), redeemGiftCard({ shopId: SHOP, giftCardId: G6, amount: 40 })]);
    assert.deepEqual(pos.map(r => r.applied).sort((a, b) => a - b), [10, 40]);
    assert.equal(await bal(G6), 0);
    //    c) a cancel lands while the redemption is mid-flight → value comes back.
    const G7 = uuid(7), F = uuid(110);
    await card(G7, 'MIDFLIGHT', 50);
    await booking(F);
    await Promise.all([
      psql(['-c', `begin; select * from public.gift_redeem_for_appointment('${SHOP}', 'MIDFLIGHT', 40, '${F}', true); select pg_sleep(0.4); commit;`]),
      new Promise(r => setTimeout(r, 100)).then(() => setStatus(F, 'cancelled')),
    ]);
    assert.equal(await bal(G7), 50, 'redeem-then-cancel race: nothing lost');
    //    d) cancel first, redemption arrives during it → nothing spent.
    const H = uuid(111);
    await booking(H);
    await Promise.all([
      psql(['-c', `begin; update public.appointments set status = 'cancelled' where id = '${H}'; select pg_sleep(0.4); commit;`]),
      new Promise(r => setTimeout(r, 100)).then(() => pay(H, 40, 'MIDFLIGHT')),
    ]);
    assert.equal(await bal(G7), 50, 'cancel-then-redeem race: nothing spent');

    // 6. Failures are visible, never silent: sync failure never blocks the cancel.
    const G8 = uuid(8), I = uuid(112);
    await card(G8, 'SYNCFAIL', 30);
    await booking(I);
    await pay(I, 30, 'SYNCFAIL');
    await one(`alter function public.gift_adjust(uuid, uuid, numeric, text, uuid, boolean) rename to gift_adjust_off`);
    await setStatus(I, 'cancelled');
    assert.equal(await one(`select status from public.appointments where id = '${I}'`), 'cancelled');
    assert.equal(Number(await one(`select count(*) from public.error_logs where source = 'gift-sync'`)), 1);
    const failed = await redeemGiftCard({ shopId: SHOP, giftCardId: G8, amount: 1 });
    assert.equal(failed.applied, 0);
    assert.equal(Number(await one(`select count(*) from public.error_logs where source = 'gift-card'`)), 1, 'app-side failure logged');
    await one(`alter function public.gift_adjust_off(uuid, uuid, numeric, text, uuid, boolean) rename to gift_adjust`);
    assert.equal(Number(await one(`select public.gift_sync_appointment('${I}')`)), 30, 're-sync gives it back');
    assert.equal(await bal(G8), 30);

    // 7. Server-only.
    for (const role of ['anon', 'authenticated']) {
      const r = await psql(['-c', `set role ${role}; select * from public.gift_adjust('${SHOP}', '${G}', 500, 'restored')`]);
      assert.equal(pgError(r.err).code, '42501', `${role} cannot call it`);
    }

    // 8. The invariant: every card's balance = its value + its ledger.
    assert.equal(await consistent(), 0, 'remaining_value == initial_value + sum(ledger)');

    // 9. App wiring: the booking pays by gift FIRST and fails cleanly; confirmation
    //    and Payments show what really happened.
    const src = f => fs.readFileSync(path.join(root, f), 'utf8');
    const route = src('src/app/api/book/in-person/route.ts');
    const giftAt = route.indexOf('redeemGiftForBooking('), promoAt = route.indexOf('consumePromo('), pointsAt = route.indexOf('deductRedeemedPoints({');
    assert(giftAt > 0 && giftAt < promoAt && giftAt < pointsAt, 'gift paid before promo / points are spent');
    assert(/gift\.applied < gross - 0\.001\) \{\s*await supabaseAdmin\.from\("appointments"\)\.delete\(\)\.eq\("id", inserted\.data\.id\);\s*return NextResponse\.json\(\{ error: [^}]+\}, \{ status: 409 \}\)/.test(route), 'an unpaid gift booking is removed + 409, never silently confirmed');
    assert(/paid_with_gift: true, total: giftPaid\.gross/.test(route), 'response carries the real total');
    assert(/result\.paid_with_gift[\s\S]{0,700}Paid with gift card/.test(src('src/app/book/[shopslug]/booking-client.tsx')), 'confirmation shows the gift payment');
    assert(/redeemGiftForBooking\(\{ shopId: m\.shop_id, code: m\.gift_code, amount: want, appointmentId: appt\.id \}\)/.test(src('src/lib/finalize-booking-session.ts')), 'online partial gift linked to the booking');
    assert(src('src/app/api/pos/cash-sale/route.ts').includes('redeemGiftCard({'), 'POS uses the atomic step');
    const payments = src('src/app/dashboard/payments/page.tsx');
    assert(payments.includes('isGiftPaid(i) ? "Gift card"') && payments.includes('!i.giftSale') && payments.includes('Paid with gift card'), 'Payments labels gift payments, explains them in the detail sheet, and does not count gift-card sales as cuts');
    for (const f of ['src/app/api/book/in-person/route.ts', 'src/lib/finalize-booking-session.ts', 'src/app/api/pos/cash-sale/route.ts']) {
      assert(!/from\("gift_cards"\)\.update\(\{[^}]*remaining_value/.test(src(f)), `${f}: no read-modify-write of a card balance`);
    }

    // 10. Issuing a card by hand: a complimentary ("free") card is never income —
    //     no sale row, owner-only; a cash card still records the real cash sale.
    {
      const { NextRequest } = req('next/server');
      let inserts, authOpts;
      const fake = { from(table) { const q = { select() { return q; }, eq() { return q; }, maybeSingle() { return q; },
        insert(v) { inserts.push({ table, v }); return q; },
        then(res, rej) { return Promise.resolve(table === 'shops' ? { data: { id: SHOP, name: 'Shop', slug: 's', email: '', subscription_plan: 'pro', subscription_status: 'active' }, error: null } : { data: null, error: null }).then(res, rej); } }; return q; } };
      const { POST: issue } = load('src/app/api/gift-card/issue-cash/route.ts', {
        '@/lib/supabase-admin': { supabaseAdmin: fake },
        '@/lib/api-auth': { authorizeShop: async (_r, _s, opts) => { authOpts = opts; return opts?.ownerOnly && staffCaller ? { error: new Response(null, { status: 403 }) } : { shop: { id: SHOP } }; } },
        '@/lib/validation': { effectivePlan: p => p, planHasFeature: () => true },
        '@/lib/plans-server': { ensurePlansHydrated: async () => {} },
        '@/lib/gift-card-server': { generateGiftCode: () => 'FREE-CODE-1', sendGiftCardEmails: async () => {} },
      });
      let staffCaller = false;
      const call = body => issue(new NextRequest('https://clipwise.ca/api', { method: 'POST', body: JSON.stringify({ shop_id: SHOP, amount: 50, ...body }) }));
      inserts = []; assert.equal((await call({ mode: 'free', note: 'Apology' })).status, 200);
      assert.deepEqual(inserts.map(i => i.table), ['gift_cards'], 'free card: no income row');
      assert.equal(inserts[0].v.note, 'Complimentary — Apology');
      assert.equal(authOpts?.ownerOnly, true, 'free cards are owner-only');
      staffCaller = true; inserts = []; assert.equal((await call({ mode: 'free' })).status, 403); assert.equal(inserts.length, 0);
      staffCaller = false; inserts = []; assert.equal((await call({ mode: 'cash' })).status, 200);
      assert.deepEqual(inserts.map(i => i.table), ['gift_cards', 'transactions'], 'cash card records the real sale');
      assert.equal(inserts[1].v.source, 'gift_card_sale'); assert.equal(inserts[1].v.amount, 50);
      inserts = []; assert.equal((await call({ mode: 'comp' })).status, 400); assert.equal(inserts.length, 0);
      const page = src('src/app/dashboard/gift-cards/page.tsx');
      assert(/payment_method: "" \};/.test(page) && page.includes('Choose how this card is paid for'), 'no default payment — must choose');
    }

    // 11. Owner corrections (phase70): the old Gift Cards "Redeem" button wrote the
    //     balance from the browser. Now: owner-only server route → one locked step
    //     that refuses overdraw / above-value / voided cards and records WHY.
    {
      const { NextRequest } = req('next/server');
      const OWNER = uuid(900);
      let staffCaller = false;
      const { POST: manage, GET: history } = load('src/app/api/gift-card/manage/route.ts', {
        '@/lib/supabase-admin': { supabaseAdmin: db },
        '@/lib/api-auth': { authorizeShop: async (_r, shopId, opts) => (opts?.ownerOnly !== true || staffCaller)
          ? { error: new Response(null, { status: 403 }) } : { user: { id: OWNER }, shop: { id: shopId }, isOwner: true } },
      });
      const G9 = uuid(9);
      await card(G9, 'MANAGE-50', 50);
      const call = async body => { const r = await manage(new NextRequest('https://clipwise.ca/api', { method: 'POST', body: JSON.stringify({ shop_id: SHOP, gift_card_id: G9, ...body }) })); return { status: r.status, j: await r.json().catch(() => null) }; };
      const adjust = (amount, reason = 'Used before ClipWise') => call({ action: 'adjust', amount, reason });

      assert.deepEqual(await adjust(-20), { status: 200, j: { ok: true, applied: -20, balance: 30 } });
      assert.equal(await bal(G9), 30);
      const row = JSON.parse(await one(`select json_agg(l) from public.gift_card_ledger l where gift_card_id = '${G9}'`))[0];
      assert.equal(row.action, 'adjusted'); assert.equal(Number(row.amount), -20);
      assert.equal(row.note, 'Used before ClipWise', 'the reason is saved on the history row');
      assert.equal(row.created_by, OWNER, 'and who made it');

      assert.equal((await adjust(-40)).status, 409, 'never overdraws — all or nothing');
      assert.equal((await adjust(30)).status, 409, 'never above the original value');
      assert.equal(await bal(G9), 30);
      assert.equal((await adjust(-5, '   ')).status, 400, 'a reason is required');
      assert.equal((await adjust(0)).status, 400);
      assert.equal((await call({ action: 'redeem', amount: -5, reason: 'x' })).status, 400, 'unknown action');
      staffCaller = true;
      assert.equal((await adjust(-5)).status, 403, 'owner-only');
      staffCaller = false;
      assert.equal(await bal(G9), 30);
      //    Wrong shop: the card id belongs to SHOP, the caller owns OTHER → nothing found, nothing changed.
      const wrongShop = await manage(new NextRequest('https://clipwise.ca/api', { method: 'POST', body: JSON.stringify({ shop_id: OTHER, gift_card_id: G9, action: 'adjust', amount: -5, reason: 'x' }) }));
      assert.equal(wrongShop.status, 404);
      assert.equal(await bal(G9), 30);

      //    Void → can't be adjusted or spent; reactivate → usable again. Both on the record.
      assert.equal((await call({ action: 'void', reason: 'Lost card' })).status, 200);
      assert.equal(await active(G9), false);
      assert.equal((await adjust(-5)).status, 409, 'a voided card is not adjustable');
      assert.equal((await redeemGiftCard({ shopId: SHOP, giftCardId: G9, amount: 5 })).applied, 0, 'nor spendable');
      assert.equal((await call({ action: 'void' })).status, 409, 'already voided');
      assert.equal((await call({ action: 'reactivate', reason: 'Found it' })).status, 200);
      assert.equal(await active(G9), true);
      assert.equal(await bal(G9), 30, 'void / reactivate never touch the balance');
      assert.deepEqual((await adjust(20, 'Charged by mistake')).j, { ok: true, applied: 20, balance: 50 });

      //    Two corrections at once on separate connections: $50 card, each removing $30 → exactly one.
      const race = await Promise.all([adjust(-30), adjust(-30)]);
      assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
      assert.equal(await bal(G9), 20);

      //    History (owner-only) tells the whole story, with reasons.
      const h = await (await history(new NextRequest(`https://clipwise.ca/api?shop_id=${SHOP}&gift_card_id=${G9}`))).json();
      assert.deepEqual(h.history.map(r => r.action).sort(), ['adjusted', 'adjusted', 'adjusted', 'reactivated', 'voided']);
      assert(h.history.some(r => r.action === 'voided' && r.note === 'Lost card' && Number(r.amount) === 0));
      staffCaller = true;
      assert.equal((await history(new NextRequest(`https://clipwise.ca/api?shop_id=${SHOP}&gift_card_id=${G9}`))).status, 403);
      staffCaller = false;

      //    The browser can read cards but never write them; the new steps are server-only.
      for (const role of ['anon', 'authenticated']) {
        const w = await psql(['-c', `set role ${role}; update public.gift_cards set remaining_value = 999 where id = '${G9}'`]);
        assert.equal(pgError(w.err).code, '42501', `${role} cannot write a balance`);
        const f = await psql(['-c', `set role ${role}; select * from public.gift_adjust_manual('${SHOP}', '${G9}', 5, 'x', null)`]);
        assert.equal(pgError(f.err).code, '42501', `${role} cannot call the correction step`);
      }
      assert.equal(await bal(G9), 20);
      assert.equal(await consistent(), 0, 'still: balance == value + sum(ledger)');

      //    App wiring: no browser write left on the Gift Cards page; "Use" opens POS with the code.
      const page = src('src/app/dashboard/gift-cards/page.tsx');
      assert(!/from\("gift_cards"\)\.(update|insert|delete)\(/.test(page), 'Gift Cards page never writes a card from the browser');
      assert(page.includes('router.push(`/dashboard/pos?gift=${encodeURIComponent(clean)}`)'), '"Use at checkout" opens POS with the code');
      assert(page.includes('fetch("/api/gift-card/manage"'), 'corrections go through the server route');
      const posPage = src('src/app/dashboard/pos/page.tsx');
      assert(/new URLSearchParams\(window\.location\.search\)\.get\("gift"\)[\s\S]{0,200}applyGift\(code\)/.test(posPage), 'POS applies the ?gift= code');
    }

    const version = await one('show server_version');
    console.log(`PASS gift-card integrity (real PostgreSQL ${version} + phase69/70): cancel gives value back once, reinstate re-spends, no-show keeps it, all-or-nothing, no spend on cancelled/other-shop/deactivated cards, never above original value, booking + POS races can't double-spend, cancel/redeem races lose nothing, failures logged, server-only, balance == value + ledger, app wiring, free cards are never income, owner corrections are owner-only / locked / never overdraw or exceed value / refuse voided cards / record the reason, void + reactivate recorded, browser can't write balances, Use-at-checkout prefills POS`);
  } finally { stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
