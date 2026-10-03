// Refunds made straight in Stripe are imported ONE Stripe refund at a time, each
// with its own amount and date (audit finding, 2026-10-03): $10 refunded Monday +
// the other $30.25 Friday must land as −$10 Monday and −$30.25 Friday — not
// −$40.25 Friday (or nothing at all if only the $10 happens). Proven on a REAL
// PostgreSQL with the real refund-ledger + refund-import code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { startPg, makeDb } = require('./helpers/real-pg.cjs');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(rel, mocks) {
  const f = path.join(root, rel), m = new Module(f, module); m.filename = f;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
  return m.exports;
}
const SHOP = '11111111-1111-4111-8111-111111111111', APPT = '22222222-2222-4222-8222-222222222222', APPT2 = '33333333-3333-4333-8333-333333333333';
const MON = Date.parse('2026-10-05T15:00:00Z') / 1000, FRI = Date.parse('2026-10-09T18:00:00Z') / 1000;
const { psql, stop } = startPg();

(async () => {
  try {
    // ── 1. The pure rule ────────────────────────────────────────────────────
    const { refundsToImport } = load('src/lib/refund-import.ts', { '@/lib/supabase-admin': { supabaseAdmin: {} }, '@/lib/stripe': { stripe: {} } });
    const id = r => `rec:${r}`;
    const re = (rid, amount, created, status = 'succeeded') => ({ id: rid, amount, created, status });
    assert.deepEqual(refundsToImport([re('re_1', 1000, MON)], [], id), [{ refundId: 're_1', cents: 1000, created: MON }], 'first partial');
    assert.deepEqual(refundsToImport([re('re_1', 1000, MON)], [{ id: 'rec:re_1', cents: 1000 }], id), [], 'redelivery → nothing');
    assert.deepEqual(refundsToImport([re('re_2', 3025, FRI), re('re_1', 1000, MON)], [{ id: 'rec:re_1', cents: 1000 }], id), [{ refundId: 're_2', cents: 3025, created: FRI }], 'second partial, own date');
    assert.deepEqual(refundsToImport([re('re_1', 4025, MON)], [{ id: 'rec:pi_A', cents: 4025 }], id), [], 'older record keyed by the charge covers it');
    assert.deepEqual(refundsToImport([re('re_1', 1000, MON), re('re_2', 3025, FRI)], [{ id: 'rec:pi_A', cents: 1000 }], id), [{ refundId: 're_2', cents: 3025, created: FRI }], 'older record covers the earliest refund');
    assert.deepEqual(refundsToImport([re('re_1', 1000, MON, 'failed'), re('re_2', 500, MON, 'canceled')], [], id), [], 'failed / cancelled refunds moved no money');
    assert.deepEqual(refundsToImport([re('re_1', 1000, MON, 'pending')], [], id).length, 1, 'pending refund already left the balance');

    // ── 2. The real thing, on PostgreSQL ────────────────────────────────────
    const schema = await psql(['-c', `
      create table public.transactions (id uuid primary key default gen_random_uuid(), shop_id uuid, barber_id uuid, appointment_id uuid,
        client_name text, service_name text, amount numeric, tip numeric, tax numeric, stripe_fee numeric, commission_amount numeric,
        payment_method text check (payment_method = any (array['card','cash','online','gift_card'])),
        type text check (type = any (array['service','product','tip'])), source text, payment_intent_id text,
        refunded boolean default false, created_at timestamptz default now());
      create unique index transactions_one_row_per_charge on public.transactions (payment_intent_id)
        where payment_intent_id is not null and source is distinct from 'refund';
      create table public.appointments (id uuid primary key, shop_id uuid, barber_id uuid, client_name text, total_amount numeric,
        tax_amount numeric, tip_amount numeric, date date, status text, payment_status text, payment_intent_id text);
      create table public.error_logs (id uuid primary key default gen_random_uuid(), level text, source text, message text, path text, shop_id uuid);
      insert into public.appointments values ('${APPT}', '${SHOP}', null, 'Jake', 40.25, 5.25, 0, '2026-10-05', 'completed', 'paid', 'pi_A');
      insert into public.transactions (shop_id, appointment_id, client_name, service_name, amount, tax, tip, commission_amount, stripe_fee, payment_method, type, source, payment_intent_id)
        values ('${SHOP}', '${APPT}', 'Jake', 'Skin Fade', 35, 5.25, 0, 17.5, 1.47, 'card', 'service', 'completion', 'pi_A');`]);
    assert.equal(schema.code, 0, schema.err);
    const base = makeDb(psql);
    // The test DB has no services table: drop the embedded "services(name)" select.
    const db = { ...base, from(t) { const q = base.from(t); const sel = q.select; q.select = c => sel.call(q, typeof c === 'string' ? c.replace(/,\s*services\(name\)/, '') : c); return q; } };
    let stripeList = [], failList = false;
    const mocks = {
      '@/lib/supabase-admin': { supabaseAdmin: db },
      '@/lib/stripe': { stripe: { refunds: { list: async () => { if (failList) throw new Error('offline'); return { data: stripeList }; } } } },
    };
    const { importChargeRefunds } = load('src/lib/refund-import.ts', mocks);
    const { recordRefundLedger } = load('src/lib/refund-ledger.ts', mocks);
    const q = async sql => JSON.parse((await psql(['-c', `select coalesce(json_agg(t), '[]') from (${sql}) t`])).out);
    const refunds = pi => q(`select amount::float, tax::float, tip::float, commission_amount::float, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, payment_method from public.transactions where source = 'refund' and payment_intent_id = '${pi}' order by created_at`);
    const imp = (pi, full, amountRefunded, created = FRI, chargeId = `ch_${pi}`) => importChargeRefunds({ chargeId, paymentIntentId: pi, account: 'acct', fullyRefunded: full, amountRefunded, eventCreated: created });
    const apptPay = async () => (await q(`select payment_status from public.appointments where id = '${APPT}'`))[0].payment_status;
    const saleFlag = async () => (await q(`select refunded from public.transactions where payment_intent_id = 'pi_A' and source = 'completion'`))[0].refunded;

    // Monday: $10 refunded in the Stripe dashboard.
    stripeList = [re('re_1', 1000, MON)];
    let r = await imp('pi_A', false, 1000, MON);
    assert.deepEqual(r.recorded.map(x => x.cents), [1000]);
    assert.deepEqual(await refunds('pi_A'), [{ amount: -8.7, tax: -1.3, tip: 0, commission_amount: -4.35, day: '2026-10-05', payment_method: 'card' }], '−$10 on MONDAY; tax + commission share');
    assert.equal(await apptPay(), 'paid', 'partial → visit stays paid'); assert.equal(await saleFlag(), false);
    // The same event again → nothing new.
    r = await imp('pi_A', false, 1000, MON); assert.equal(r.recorded.length, 0); assert.equal((await refunds('pi_A')).length, 1);
    // Friday: the other $30.25 → its own record, its own date; now fully refunded.
    stripeList = [re('re_1', 1000, MON), re('re_2', 3025, FRI)];
    r = await imp('pi_A', true, 4025, FRI);
    assert.deepEqual(r.recorded.map(x => x.cents), [3025]); assert.equal(r.flipped, true);
    const rows = await refunds('pi_A');
    assert.deepEqual(rows.map(x => x.day), ['2026-10-05', '2026-10-09'], 'Monday and Friday, not all on Friday');
    const sum = k => Math.round(rows.reduce((s, x) => s + x[k], 0) * 100) / 100;
    assert.equal(sum('amount') + sum('tax') + sum('tip'), -40.25, 'all of it, once');
    assert.equal(sum('tax'), -5.25, 'tax adds back exactly'); assert.equal(sum('commission_amount'), -17.5, 'commission adds back exactly');
    assert.equal(await apptPay(), 'refunded', 'full → visit refunded'); assert.equal(await saleFlag(), true);
    // Redelivered Friday event → still two records.
    r = await imp('pi_A', true, 4025, FRI); assert.equal(r.recorded.length, 0); assert.equal((await refunds('pi_A')).length, 2);

    // In-app refund first (keyed by Stripe's refund id), then its webhook → no double.
    await psql(['-c', `insert into public.transactions (shop_id, client_name, service_name, amount, tax, tip, payment_method, type, source, payment_intent_id)
      values ('${SHOP}', 'Walk-in', 'Beard', 20, 2.6, 0, 'card', 'service', 'pos', 'pi_B')`]);
    assert.equal(await recordRefundLedger({ shopId: SHOP, clientName: 'Walk-in', serviceName: 'Beard', refundedCents: 2260, taxCents: 260, paymentIntentId: 'pi_B', stripeRefundId: 're_B' }), 'recorded');
    stripeList = [re('re_B', 2260, FRI)];
    r = await imp('pi_B', true, 2260); assert.equal(r.recorded.length, 0); assert.equal((await refunds('pi_B')).length, 1);
    // Route + webhook at the SAME moment for one refund → one record.
    await psql(['-c', `insert into public.transactions (shop_id, client_name, service_name, amount, tax, tip, payment_method, type, source, payment_intent_id)
      values ('${SHOP}', 'Walk-in', 'Cut', 30, 3.9, 0, 'card', 'service', 'pos', 'pi_C')`]);
    stripeList = [re('re_C', 3390, FRI)];
    await Promise.all([imp('pi_C', true, 3390), imp('pi_C', true, 3390),
      recordRefundLedger({ shopId: SHOP, refundedCents: 3390, taxCents: 390, paymentIntentId: 'pi_C', stripeRefundId: 're_C' })]);
    assert.equal((await refunds('pi_C')).length, 1, 'one record under a race');
    const posRow = (await refunds('pi_C'))[0]; assert.deepEqual([posRow.amount, posRow.tax], [-30, -3.9], 'POS split by its own row');

    // A record written the OLD way (keyed by the charge) is never added again.
    await psql(['-c', `insert into public.transactions (shop_id, client_name, service_name, amount, tax, tip, payment_method, type, source, payment_intent_id)
      values ('${SHOP}', 'Old', 'Cut', 30, 3.9, 0, 'card', 'service', 'pos', 'pi_D')`]);
    assert.equal(await recordRefundLedger({ shopId: SHOP, refundedCents: 3390, taxCents: 390, paymentIntentId: 'pi_D' }), 'recorded');
    stripeList = [re('re_D', 3390, MON)];
    r = await imp('pi_D', true, 3390); assert.equal(r.recorded.length, 0); assert.equal((await refunds('pi_D')).length, 1);

    // A chargeback is not a refund: its record never hides a real refund.
    await psql(['-c', `insert into public.transactions (shop_id, client_name, service_name, amount, tax, tip, payment_method, type, source, payment_intent_id)
      values ('${SHOP}', 'Disp', 'Cut', 30, 3.9, 0, 'card', 'service', 'pos', 'pi_E')`]);
    assert.equal(await recordRefundLedger({ shopId: SHOP, serviceName: 'Cut (chargeback)', refundedCents: 1000, paymentIntentId: 'pi_E', dedupeKey: 'dispute:dp_1' }), 'recorded');
    stripeList = [re('re_E', 1000, FRI)];
    r = await imp('pi_E', false, 1000); assert.deepEqual(r.recorded.map(x => x.cents), [1000]);

    // Stripe's list can't be read → its running total, never doubled.
    await psql(['-c', `insert into public.transactions (shop_id, client_name, service_name, amount, tax, tip, payment_method, type, source, payment_intent_id)
      values ('${SHOP}', 'F', 'Cut', 35, 5.25, 0, 'card', 'service', 'pos', 'pi_F')`]);
    failList = true;
    r = await imp('pi_F', false, 1000, MON); assert.deepEqual(r.recorded.map(x => x.cents), [1000]);
    r = await imp('pi_F', false, 1000, MON); assert.equal(r.recorded.length, 0, 'same total again → nothing');
    r = await imp('pi_F', true, 4025, FRI); assert.deepEqual(r.recorded.map(x => x.cents), [3025], 'only the new part');
    failList = false;

    // Reports: the money comes off on the day it went back.
    const rev = load('src/lib/revenue.ts', mocks);
    const ledger = await q(`select amount::float, tax::float, tip::float, payment_method, source, payment_intent_id, created_at::text, client_name from public.transactions where payment_intent_id = 'pi_A'`);
    const appt = { id: APPT, client_name: 'Jake', total_amount: 40.25, tax_amount: 5.25, tip_amount: 0, payment_status: 'refunded', payment_method: 'card', payment_intent_id: 'pi_A', status: 'completed' };
    const onDay = d => ledger.filter(t => t.source === 'refund' && t.created_at.startsWith(d));
    assert.equal(Math.round(rev.collectedTotals([], onDay('2026-10-05')).refunds * 100), 1000, 'Monday: $10 refunded');
    assert.equal(Math.round(rev.collectedTotals([], onDay('2026-10-09')).refunds * 100), 3025, 'Friday: $30.25 refunded');
    assert.equal(Math.round(rev.collectedTotals([appt], ledger).gross * 100), 0, 'sale + both refunds = 0');

    // Wiring: the webhook uses the importer for every refund (not only full ones).
    const hook = fs.readFileSync(path.join(root, 'src/app/api/webhooks/stripe/route.ts'), 'utf8');
    assert(/case "charge\.refunded": \{[\s\S]{0,600}importChargeRefunds\(/.test(hook), 'charge.refunded imports refunds one by one');
    assert(!/if \(pi && ch\.refunded\)/.test(hook), 'no longer full-refunds only');
    assert.equal((hook.match(/dedupeKey: `dispute:\$\{dispute\.id\}`/g) ?? []).length, 2, 'chargebacks keyed by their dispute');

    const version = (await psql(['-c', 'show server_version'])).out;
    console.log(`PASS refund import (real PostgreSQL ${version}): Stripe refunds imported one by one — $10 Monday + $30.25 Friday land on their own days, partial keeps the visit paid, full marks it refunded, tax + commission add back exactly, redelivery / route-then-webhook / simultaneous delivery record once, old charge-keyed records and chargebacks handled, failed refunds skipped, list outage falls back to running total without doubling`);
  } finally { stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
