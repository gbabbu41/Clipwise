// Loyalty points can't silently disappear or double up — proven against a REAL
// PostgreSQL with the real phase68 migration and the real app code.
// Incident (2026-09-27): 423 points spent on a pay-at-shop booking that was
// cancelled 4 minutes later were never given back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { startPg, pgError, makeDb } = require('./helpers/real-pg.cjs');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const { NextRequest } = req('next/server');

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
    // Prod shape of the columns involved (incl. the status CHECK), then the REAL migration.
    const schema = await psql(['-c', `
      create table public.shops (id uuid primary key, owner_id text, subscription_plan text, subscription_status text, booking_settings jsonb);
      create table public.clients (id uuid primary key default gen_random_uuid(), shop_id uuid references public.shops(id), name text, email text, phone text, loyalty_points integer default 0);
      create table public.appointments (id uuid primary key default gen_random_uuid(), shop_id uuid references public.shops(id), client_id uuid references public.clients(id), client_email text, client_phone text,
        total_amount numeric, loyalty_awarded boolean default false, payment_status text,
        status text check (status = any (array['pending','confirmed','completed','cancelled','no-show'])));
      create table public.loyalty_rewards (id uuid primary key default gen_random_uuid(), shop_id uuid references public.shops(id) on delete cascade,
        client_id uuid references public.clients(id) on delete cascade, points integer, action text, created_at timestamptz default now());
      create table public.error_logs (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), level text, source text, message text, stack text, path text, user_agent text, user_id uuid, shop_id uuid);
      create role service_role; create role anon; create role authenticated;
      insert into public.shops values ('${SHOP}', 'owner', 'pro', 'active', '{"loyalty":{"enabled":true,"redemption_rate":5,"points_per_visit":15,"points_per_dollar":1}}'),
                                      ('${OTHER}', 'other', 'pro', 'active', '{}');`]);
    assert.equal(schema.code, 0, schema.err);
    const mig = await psql(['-f', path.join(root, 'supabase/migrations/phase68_loyalty_ledger_integrity.sql')]);
    assert.equal(mig.code, 0, mig.err);
    const mig73 = await psql(['-v', 'ON_ERROR_STOP=1', '-f', path.join(root, 'supabase/migrations/phase73_loyalty_refund_reversal.sql')]);
    assert.equal(mig73.code, 0, mig73.err);

    const one = async sql => { const r = await psql(['-c', sql]); assert.equal(r.code, 0, r.err); return r.out; };
    const bal = async id => Number(await one(`select loyalty_points from public.clients where id = '${id}'`));
    const ledger = async (where) => JSON.parse(await one(`select coalesce(json_agg(json_build_object('points', points, 'action', action) order by created_at, action), '[]') from public.loyalty_rewards where ${where}`));
    const consistent = async () => Number(await one(`select count(*) from public.clients c where c.loyalty_points <> coalesce((select sum(points) from public.loyalty_rewards r where r.client_id = c.id), 0)`));
    const client = async (id, email, points = 0, shop = SHOP) => {
      await one(`insert into public.clients (id, shop_id, name, email, loyalty_points) values ('${id}', '${shop}', 'C', ${email ? `'${email}'` : 'null'}, 0)`);
      if (points) await one(`select public.loyalty_adjust('${shop}', '${id}', ${points}, 'added')`);
    };
    const booking = async (id, email, status = 'confirmed', total = 40.25) =>
      one(`insert into public.appointments (id, shop_id, client_email, total_amount, status) values ('${id}', '${SHOP}', '${email}', ${total}, '${status}')`);
    const setStatus = (id, status) => one(`update public.appointments set status = '${status}' where id = '${id}'`);

    const db = makeDb(psql, { setOfFns: ['loyalty_adjust'], auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) } });
    const mocks = {
      '@/lib/supabase-admin': { supabaseAdmin: db },
      '@/lib/validation': { effectivePlan: p => p, planHasFeature: () => true },
      '@/lib/plans-server': { ensurePlansHydrated: async () => {} },
      '@/lib/emailer': { sendAppEmail: async () => {} },
    };
    const { deductRedeemedPoints, exactIlike } = load('src/lib/loyalty-redeem.ts', mocks);
    const { awardLoyaltyForAppointment } = load('src/lib/completion-server.ts', mocks);
    const { POST: pointsRoute } = load('src/app/api/loyalty/points/route.ts', mocks);
    const manual = (client_id, points) => pointsRoute(new NextRequest('https://clipwise.ca/api', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ client_id, points, shop_id: SHOP }) }));

    // 1. The incident: 423 points spent on a booking, booking cancelled (any path —
    //    here a plain UPDATE, like the owner's calendar) → points come back, once.
    const baljit = uuid(1), apptA = uuid(101);
    await client(baljit, 'gbabbu41@gmail.com', 423);
    await booking(apptA, 'gbabbu41@gmail.com');
    assert.equal(await deductRedeemedPoints({ shopId: SHOP, email: 'GBABBU41@gmail.com', points: 423, appointmentId: apptA }), 423);
    assert.equal(await bal(baljit), 0);
    await setStatus(apptA, 'cancelled');
    assert.equal(await bal(baljit), 423, 'cancelled booking gives the points back');
    await setStatus(apptA, 'no-show');   // void → void: nothing more
    assert.equal(await bal(baljit), 423, 'never restored twice');
    await setStatus(apptA, 'confirmed'); // reinstated → spent again
    assert.equal(await bal(baljit), 0);
    await setStatus(apptA, 'completed');
    assert.equal(await bal(baljit), 0, 'completing keeps the redemption spent');
    assert.deepEqual((await ledger(`appointment_id = '${apptA}'`)).map(r => r.action), ['redeemed', 'restored', 'reapplied']);

    // No-show also gives points back; a repeated deduction for the same booking is a no-op.
    const apptB = uuid(102);
    await booking(apptB, 'gbabbu41@gmail.com');
    await one(`select public.loyalty_adjust('${SHOP}', '${baljit}', 200, 'added')`);
    assert.equal(await deductRedeemedPoints({ shopId: SHOP, email: 'gbabbu41@gmail.com', points: 150, appointmentId: apptB }), 150);
    assert.equal(await deductRedeemedPoints({ shopId: SHOP, email: 'gbabbu41@gmail.com', points: 150, appointmentId: apptB }), 0, 'finalize retry spends nothing');
    assert.equal(await bal(baljit), 50);
    await setStatus(apptB, 'no-show');
    assert.equal(await bal(baljit), 200);

    // A booking cancelled BEFORE its points were deducted never spends them.
    const apptC = uuid(103);
    await booking(apptC, 'gbabbu41@gmail.com', 'cancelled');
    assert.equal(await deductRedeemedPoints({ shopId: SHOP, email: 'gbabbu41@gmail.com', points: 100, appointmentId: apptC }), 0);
    assert.equal(await bal(baljit), 200);

    // Reinstating after the points were spent elsewhere never drives the balance negative.
    const apptD = uuid(104);
    await booking(apptD, 'gbabbu41@gmail.com');
    await deductRedeemedPoints({ shopId: SHOP, email: 'gbabbu41@gmail.com', points: 150, appointmentId: apptD });
    await setStatus(apptD, 'cancelled');                                            // back to 200
    await one(`select public.loyalty_adjust('${SHOP}', '${baljit}', -180, 'redeemed')`);  // spent elsewhere → 20
    await setStatus(apptD, 'confirmed');
    assert.equal(await bal(baljit), 0, 'capped at the real balance');

    // 2. Real races (separate connections).
    // a) cancel lands while the redemption is mid-flight → points still come back.
    const racer = uuid(2), apptE = uuid(105);
    await client(racer, 'race@x.com', 300);
    await booking(apptE, 'race@x.com');
    await Promise.all([
      psql(['-c', `begin; select public.loyalty_redeem_for_appointment('${SHOP}', '${racer}', 300, '${apptE}'); select pg_sleep(0.4); commit;`]),
      new Promise(r => setTimeout(r, 100)).then(() => setStatus(apptE, 'cancelled')),
    ]);
    assert.equal(await bal(racer), 300, 'redeem-then-cancel race: nothing lost');
    // b) cancel first, redemption arrives during it → never spent.
    const apptF = uuid(106);
    await booking(apptF, 'race@x.com');
    await Promise.all([
      psql(['-c', `begin; update public.appointments set status = 'cancelled' where id = '${apptF}'; select pg_sleep(0.4); commit;`]),
      new Promise(r => setTimeout(r, 100)).then(() => psql(['-c', `select public.loyalty_redeem_for_appointment('${SHOP}', '${racer}', 300, '${apptF}')`])),
    ]);
    assert.equal(await bal(racer), 300, 'cancel-then-redeem race: nothing spent');
    // c) 30 simultaneous earn/redeem changes — no lost updates.
    const busy = uuid(3);
    await client(busy, 'busy@x.com', 500);
    await Promise.all(Array.from({ length: 30 }, (_, i) => psql(['-c', `select public.loyalty_adjust('${SHOP}', '${busy}', ${i % 3 === 0 ? -20 : 15}, '${i % 3 === 0 ? 'redeemed' : 'added'}')`])));
    assert.equal(await bal(busy), 500 + 20 * 15 - 10 * 20);
    // d) the same completed visit awarded twice at once → earned once.
    const earner = uuid(4), apptG = uuid(107);
    await client(earner, 'earn@x.com');
    await booking(apptG, 'earn@x.com', 'completed', 40.25);
    const awards = await Promise.all([awardLoyaltyForAppointment(apptG), awardLoyaltyForAppointment(apptG)]);
    assert.equal(await bal(earner), 55, '15/visit + 1/$ once');
    assert.equal(awards.filter(a => a.points === 55).length, 1);
    // d2) a walk-in saved by name only (no email / phone) is found by the saved
    //     client link and earns once; a link to ANOTHER shop's client earns nothing
    //     and a booking with no client at all stays unclaimed (retryable later).
    const walkIn = uuid(60), apptW = uuid(160);
    await client(walkIn, null);
    await one(`insert into public.appointments (id, shop_id, client_id, total_amount, status) values ('${apptW}', '${SHOP}', '${walkIn}', 40.25, 'completed')`);
    await Promise.all([awardLoyaltyForAppointment(apptW), awardLoyaltyForAppointment(apptW)]);
    assert.equal(await bal(walkIn), 55, 'walk-in linked by client_id earns once');
    const foreign = uuid(61), apptX = uuid(161);
    await client(foreign, null, 0, OTHER);
    await one(`insert into public.appointments (id, shop_id, client_id, total_amount, status) values ('${apptX}', '${SHOP}', '${foreign}', 40.25, 'completed')`);
    assert.equal((await awardLoyaltyForAppointment(apptX)).skipped, 'no_client');
    assert.equal(await bal(foreign), 0, 'another shop\'s client never earns');
    const apptY = uuid(162);
    await one(`insert into public.appointments (id, shop_id, total_amount, status) values ('${apptY}', '${SHOP}', 40.25, 'completed')`);
    assert.equal((await awardLoyaltyForAppointment(apptY)).skipped, 'no_client');
    assert.equal(await one(`select loyalty_awarded from public.appointments where id = '${apptY}'`), 'f', 'no client → left unclaimed');
    // d3) phase73 — a FULL REFUND undoes the visit's points: spent points come
    //     back, earned points are taken back; a repeat/concurrent refund changes
    //     nothing more; the balance never goes negative.
    const refunder = uuid(62), apptR = uuid(163);
    await client(refunder, 'refund@x.com', 500);
    await booking(apptR, 'refund@x.com', 'confirmed', 15.93);
    await one(`select public.loyalty_redeem_for_appointment('${SHOP}', '${refunder}', 423, '${apptR}')`);
    await setStatus(apptR, 'completed');
    assert.equal((await awardLoyaltyForAppointment(apptR)).points, 31);
    assert.equal(await bal(refunder), 500 - 423 + 31);
    await Promise.all([1, 2].map(() => psql(['-c', `update public.appointments set payment_status = 'refunded' where id = '${apptR}'`])));
    assert.equal(await bal(refunder), 500, 'refund: 423 given back, 31 taken back — once');
    assert.deepEqual((await ledger(`appointment_id = '${apptR}'`)).map(r => r.action).sort(), ['earned', 'redeemed', 'restored', 'revoked']);
    await one(`update public.appointments set payment_status = 'refunded', status = 'completed' where id = '${apptR}'`);
    assert.equal(await bal(refunder), 500, 'no-op re-save');
    //     A refunded visit never earns afterwards.
    const apptR2 = uuid(164);
    await one(`insert into public.appointments (id, shop_id, client_email, total_amount, status, payment_status) values ('${apptR2}', '${SHOP}', 'refund@x.com', 20, 'completed', 'refunded')`);
    assert.equal((await awardLoyaltyForAppointment(apptR2)).skipped, 'refunded');
    //     Earned points already spent elsewhere: take back only what's there (never negative).
    const spender = uuid(63), apptS = uuid(165);
    await client(spender, 'spend@x.com');
    await booking(apptS, 'spend@x.com', 'completed', 40.25);
    await awardLoyaltyForAppointment(apptS);
    await one(`select public.loyalty_adjust('${SHOP}', '${spender}', -50, 'redeemed')`);
    await one(`update public.appointments set payment_status = 'refunded' where id = '${apptS}'`);
    assert.equal(await bal(spender), 0, 'never below zero');
    // e) two staff redeem 300 each from 423 at the same moment → one succeeds, never overdrawn.
    const shared = uuid(5);
    await client(shared, 'shared@x.com', 423);
    const two = await Promise.all([manual(shared, -300), manual(shared, -300)]);
    assert.deepEqual(two.map(r => r.status).sort(), [200, 400]);
    assert.equal(await bal(shared), 123);

    // 3. Failures are visible, never silent.
    //    Earn failure: claim released (retryable) + logged.
    const apptH = uuid(108);
    await booking(apptH, 'earn@x.com', 'completed', 10);
    const realRpc = db.rpc;
    db.rpc = async () => ({ data: null, error: { code: '08006', message: 'connection reset' } });
    assert.equal((await awardLoyaltyForAppointment(apptH)).ok, false);
    db.rpc = realRpc;
    assert.equal(await one(`select loyalty_awarded from public.appointments where id = '${apptH}'`), 'f', 'claim released');
    assert.equal(Number(await one(`select count(*) from public.error_logs where source = 'loyalty' and path = 'awardLoyaltyForAppointment'`)), 1);
    assert.equal((await awardLoyaltyForAppointment(apptH)).points, 25, 'retry awards it once');
    //    Sync failure never blocks the cancel and is logged.
    const apptI = uuid(109);
    await booking(apptI, 'gbabbu41@gmail.com');
    await one(`select public.loyalty_adjust('${SHOP}', '${baljit}', 50, 'added')`);
    await deductRedeemedPoints({ shopId: SHOP, email: 'gbabbu41@gmail.com', points: 50, appointmentId: apptI });
    await one(`alter function public.loyalty_adjust(uuid, uuid, integer, text, uuid, boolean) rename to loyalty_adjust_off`);
    await setStatus(apptI, 'cancelled');
    assert.equal(await one(`select status from public.appointments where id = '${apptI}'`), 'cancelled', 'cancel still succeeds');
    assert.equal(Number(await one(`select count(*) from public.error_logs where source = 'loyalty-sync'`)), 1);
    await one(`alter function public.loyalty_adjust_off(uuid, uuid, integer, text, uuid, boolean) rename to loyalty_adjust`);
    assert.equal(Number(await one(`select public.loyalty_sync_appointment('${apptI}')`)), 50, 're-sync restores it');
    assert.equal(await bal(baljit), 50);

    // 4. Identity + isolation.
    await client(uuid(6), 'axb@x.com', 400);
    assert.equal(await deductRedeemedPoints({ shopId: SHOP, email: 'a_b@x.com', points: 100 }), 0, '"_" is not a wildcard');
    assert.equal(exactIlike('a_b%c\\d'), 'a\\_b\\%c\\\\d');
    await client(uuid(7), 'gbabbu41@gmail.com', 0, OTHER);
    assert.equal(pgError((await psql(['-c', `select public.loyalty_adjust('${OTHER}', '${baljit}', 10, 'added')`])).err).code, 'P0002', 'another shop cannot touch this client');
    for (const role of ['anon', 'authenticated']) {
      const r = await psql(['-c', `set role ${role}; select public.loyalty_adjust('${SHOP}', '${baljit}', 1000, 'added')`]);
      assert.equal(pgError(r.err).code, '42501', `${role} cannot call it`);
    }

    // 5. The invariant: every balance equals its ledger.
    assert.equal(await consistent(), 0, 'balance == sum(ledger) for every client');

    const version = await one('show server_version');
    console.log(`PASS loyalty integrity (real PostgreSQL ${version} + phase68/73): cancel/no-show restores spent points once, a full refund gives spent points back and takes earned back (once, never negative), reinstating re-spends (never negative), no spend on a cancelled booking, cancel/redeem races lose nothing, no lost updates, earn once, no overdraw, failures logged and retryable, exact email match, shop isolation, not callable by anon/authenticated, balance == ledger`);
  } finally { stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
