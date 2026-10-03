// Refund engine (owner decision 2026-10-03): every part of a payment goes back the
// way it came in — card → Stripe, cash → recorded as handed back, gift card → back
// on the card — for visits (incl. split gift + card/cash balance, separate tips),
// POS sales, cash sales and gift-card sales (unused value refunded, card voided).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript'), { NextRequest } = req('next/server');
function load(rel, mocks = {}) {
  const f = path.join(root, rel), m = new Module(f, module); m.filename = f;
  m.require = id => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : id.startsWith('./') ? load(path.relative(root, path.join(path.dirname(f), `${id}.ts`)), mocks) : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
  return m.exports;
}
const plan = load('src/lib/refund-plan.ts');
const sum = (ps, k) => ps.reduce((s, p) => s + p[k], 0);
const brief = ps => ps.map(p => `${p.kind}:${p.cents}`);

// ── 1. The plan: each part, and tax/tip split so the parts add back to the visit ──
{
  // Plain card visit: $40.25 (tax 5.25) + $5 tip on one charge.
  let ps = plan.planAppointmentRefund({ id: 'a', payment_method: 'card', payment_intent_id: 'pi_a', total_amount: 40.25, tax_amount: 5.25, tip_amount: 5 }, [{ id: 't', source: 'completion', payment_intent_id: 'pi_a', amount: 35, tax: 5.25, tip: 5 }]);
  assert.deepEqual(brief(ps), ['card:4525']); assert.equal(ps[0].taxCents, 525); assert.equal(ps[0].tipCents, 500); assert.deepEqual(ps[0].txIds, ['t']);
  // Cash visit → one cash part keyed to the booking, flags its cash completion row.
  ps = plan.planAppointmentRefund({ id: 'b', payment_method: 'cash', total_amount: 30, tax_amount: 3 }, [{ id: 'c', source: 'completion', payment_method: 'cash', amount: 27, tax: 3 }]);
  assert.deepEqual(brief(ps), ['cash:3000']); assert.equal(ps[0].key, 'cash:b'); assert.deepEqual(ps[0].txIds, ['c']);
  // Fully gift-paid visit → one gift part (back on the card).
  ps = plan.planAppointmentRefund({ id: 'g', payment_method: 'gift_card', total_amount: 40.25, tax_amount: 5.25, gift_applied: 40.25 }, []);
  assert.deepEqual(brief(ps), ['gift_card:4025']); assert.equal(ps[0].key, 'gift:g'); assert.equal(ps[0].taxCents, 525);
  // SPLIT: $25 gift card + the rest ($15.25 + $5 tip) collected later on its own card charge.
  const split = { id: 's', payment_method: 'gift_card', total_amount: 40.25, tax_amount: 5.25, tip_amount: 5, gift_applied: 25, balance_due: 0 };
  const bal = { id: 'bal', source: 'balance', payment_method: 'card', payment_intent_id: 'pi_bal', amount: 13.26, tax: 1.99, tip: 5 };
  ps = plan.planAppointmentRefund(split, [bal]);
  assert.deepEqual(brief(ps), ['card:2025', 'gift_card:2500'], 'card part first, then the gift part');
  assert.equal(sum(ps, 'cents'), 4525, 'parts add up to everything paid');
  assert.equal(sum(ps, 'taxCents'), 525, 'tax split adds back to the visit tax');
  assert.equal(sum(ps, 'tipCents'), 500, 'tip split adds back to the visit tip');
  // Same split with the rest paid in cash → a cash part keyed to that balance row.
  ps = plan.planAppointmentRefund(split, [{ ...bal, payment_method: 'cash', payment_intent_id: null }]);
  assert.deepEqual(brief(ps), ['cash:2025', 'gift_card:2500']); assert.equal(ps[0].key, 'cash:bal');
  // Rest still owed (not collected) → only what was paid goes back.
  ps = plan.planAppointmentRefund({ ...split, balance_due: 15.25 }, []);
  assert.deepEqual(brief(ps), ['gift_card:2500']);
  // A tip paid after the visit on its own charge is its own card part (not double counted).
  ps = plan.planAppointmentRefund({ id: 'p', payment_method: 'card', payment_intent_id: 'pi_p', total_amount: 40, tax_amount: 5, tip_amount: 6 },
    [{ id: 'c1', source: 'completion', payment_intent_id: 'pi_p', amount: 35, tax: 5, tip: 0 }, { id: 'c2', source: 'completion', payment_intent_id: 'pi_tip', amount: 0, tax: 0, tip: 6 }]);
  assert.deepEqual(brief(ps), ['card:4000', 'card:600']); assert.equal(ps[1].tipCents, 600);
  // Done parts are flagged (a retry never refunds them twice); refund records are ignored as sales.
  ps = plan.planAppointmentRefund(split, [bal, { id: 'r', source: 'refund', payment_intent_id: 'pi_bal', amount: -13.26, tax: -1.99, tip: -5 }], new Set(['pi_bal']));
  assert.deepEqual(ps.map(p => p.done), [true, false]);
  // A card payment with no charge on file can't be refunded from the app.
  ps = plan.planAppointmentRefund({ id: 'x', payment_method: 'card', total_amount: 10 }, []);
  assert.match(ps[0].blocked, /Stripe dashboard/);
  // No-show: the fee on its ledger row, not the booking total.
  ps = plan.planAppointmentRefund({ id: 'n', status: 'no-show', payment_method: 'card', payment_intent_id: 'pi_n', total_amount: 60 }, [{ id: 'f', payment_intent_id: 'pi_n', amount: 10, tax: 0, tip: 0, service_name: 'No-show fee — Cut' }]);
  assert.deepEqual(brief(ps), ['card:1000']);
  // POS: cash / card / card without a charge / gift-card sale (only the unused value).
  assert.deepEqual(brief([plan.planTransactionRefund({ id: 'q', payment_method: 'cash', amount: 20, tax: 2.6, tip: 3 })]), ['cash:2560']);
  assert.equal(plan.planTransactionRefund({ id: 'q', payment_method: 'cash', amount: 20, refunded: true }).done, true);
  assert.equal(plan.planTransactionRefund({ id: 'q', payment_method: 'card', payment_intent_id: 'pi_q', amount: 20 }).key, 'pi_q');
  assert.match(plan.planTransactionRefund({ id: 'q', payment_method: 'card', amount: 20 }).blocked, /Stripe dashboard/);
  const gs = plan.planTransactionRefund({ id: 'gs', source: 'gift_card_sale', payment_method: 'card', payment_intent_id: 'pi_gs', amount: 50, service_name: 'Gift Card AB12-CD34' }, new Set(), 3000);
  assert.deepEqual([gs.cents, gs.taxCents, gs.label], [3000, 0, 'Gift card sale · Card']);
  assert.equal(plan.giftSaleCode({ service_name: 'Gift Card AB12-CD34' }), 'AB12-CD34');
  assert.equal(plan.giftSaleCode({ service_name: 'Skin Fade' }), null);
  // Already partly refunded in Stripe ($10 of $45.25): only the rest is left, with its share of tax/tip.
  const cardPart = plan.planAppointmentRefund({ id: 'a', payment_method: 'card', payment_intent_id: 'pi_a', total_amount: 40.25, tax_amount: 5.25, tip_amount: 5 }, [])[0];
  const left = plan.remainingPart(cardPart, 1000);
  assert.deepEqual([left.cents, left.done], [3525, false]); assert.deepEqual([left.taxCents, left.tipCents], [409, 390], 'tax + tip scaled to what is left');
  assert.equal(plan.remainingPart(cardPart, 4525).done, true, 'fully refunded in Stripe → done');
  assert.equal(plan.remainingPart(cardPart, 0), cardPart);
  // Stripe returned less than planned → tax/tip scale down with it.
  assert.deepEqual(plan.scaleSplit({ cents: 4525, taxCents: 525, tipCents: 500 }, 2000), { taxCents: 232, tipCents: 221 });
  assert.deepEqual(plan.scaleSplit({ cents: 4525, taxCents: 525, tipCents: 500 }, 4525), { taxCents: 525, tipCents: 500 });
}

// ── 2. Reports: a gift-card part moves no money, only its tax / tip come back ──
{
  const rev = load('src/lib/revenue.ts');
  const giftRow = { client_name: 'J', source: 'refund', payment_method: 'gift_card', amount: -21.73, tax: -3.27, tip: 0, created_at: '2026-10-03T15:00:00Z', service_name: 'Refund — Skin Fade (back on gift card)' };
  const cardRow = { client_name: 'J', source: 'refund', payment_method: 'card', amount: -13.26, tax: -1.99, tip: -5, created_at: '2026-10-03T15:00:00Z', service_name: 'Refund — Skin Fade (balance · card)' };
  assert.equal(rev.isGiftRefundRow(giftRow), true); assert.equal(rev.isGiftRefundRow(cardRow), false);
  const t = rev.collectedTotals([], [giftRow, cardRow]);
  assert.equal(Math.round(t.gross * 100), -2025, 'only the card part is money out');
  assert.equal(Math.round(t.refunds * 100), 2025);
  assert.equal(Math.round(t.tax * 100), -526, 'both parts give their tax back');
  assert.equal(Math.round(t.tips * 100), -500);
  // The whole split visit, sale + refund, nets to zero money and zero tax.
  const appt = { id: 's', client_name: 'J', total_amount: 40.25, tax_amount: 5.25, tip_amount: 5, gift_applied: 25, balance_due: 0, payment_status: 'refunded', payment_method: 'gift_card', status: 'completed' };
  const balRow = { client_name: 'J', source: 'balance', payment_method: 'card', payment_intent_id: 'pi_bal', appointment_id: 's', amount: 13.26, tax: 1.99, tip: 5, created_at: '2026-10-02T15:00:00Z' };
  const all = rev.collectedTotals([appt], [balRow, { ...giftRow, amount: -21.75, tax: -3.25 }, { ...cardRow, tax: -2, amount: -13.25 }]);
  assert.equal(Math.round(all.gross * 100), 0, 'sale + refund = 0'); assert.equal(Math.round(all.tax * 100), 0, 'tax nets to 0');
  // The chart agrees (gift part adds no bar).
  const { analyticsRevenueBuckets, analyticsPeriod } = load('src/lib/analytics-period.ts');
  const range = analyticsPeriod('month', new Date('2026-10-20T12:00:00'));
  const bars = analyticsRevenueBuckets([], [giftRow, cardRow], range).daily.reduce((s, d) => s + d.revenue, 0);
  assert.equal(Math.round(bars * 100), -2025);
  assert.equal(rev.refundServiceKey('Refund — Skin Fade (back on gift card)'), 'Skin Fade');
  assert.equal(rev.refundServiceKey('Refund — Kids Cut (under 12) (balance · cash)'), 'Kids Cut (under 12)');
  assert.equal(rev.refundServiceKey('Refund — Kids Cut (under 12)'), 'Kids Cut (under 12)', 'a real parenthesis stays');
}

// ── 3. The route, end to end over an in-memory database ──────────────────────
const tables = {}, calls = { stripe: [], rpc: [], ledger: [], emails: [], notes: [] };
let failStripe = null;
function rows(t) { return (tables[t] ??= []); }
const db = {
  auth: { getUser: async tok => ({ data: { user: tok === 'owner' ? { id: 'owner' } : tok === 'other' ? { id: 'other' } : null }, error: null }) },
  from(table) {
    const st = { op: 'select', f: [], one: false, values: null, returning: false };
    const match = r => st.f.every(fn => fn(r));
    const q = {
      select() { if (st.op !== 'select') st.returning = true; return q; },
      eq(k, v) { st.f.push(r => r[k] === v); return q; }, neq(k, v) { st.f.push(r => r[k] !== v); return q; },
      in(k, vs) { st.f.push(r => vs.includes(r[k])); return q; }, limit() { return q; },
      single() { st.one = true; return q; }, maybeSingle() { st.one = true; return q; },
      update(v) { st.op = 'update'; st.values = v; return q; }, insert(v) { st.op = 'insert'; st.values = v; return q; },
      then(yes, no) {
        let out;
        if (st.op === 'insert') { rows(table).push({ id: `row${rows(table).length}`, ...st.values }); out = { data: null, error: null }; }
        else if (st.op === 'update') { const hit = rows(table).filter(match); hit.forEach(r => Object.assign(r, st.values)); out = { data: st.returning ? hit.map(r => ({ id: r.id })) : null, error: null }; }
        else { const hit = rows(table).filter(match).map(r => ({ ...r })); out = { data: st.one ? hit[0] ?? null : hit, error: null }; }
        return Promise.resolve(out).then(yes, no);
      },
    };
    return q;
  },
  async rpc(fn, args) {
    calls.rpc.push({ fn, args });
    const card = rows('gift_cards').find(g => g.id === args.p_gift_card_id);
    if (fn === 'gift_refund_sale') { const bal = card.remaining_value; if (bal <= 0) return { data: [{ refunded: 0, status: 'empty' }], error: null }; card.remaining_value = 0; card.is_active = false; return { data: [{ refunded: bal, status: 'ok' }], error: null }; }
    if (fn === 'gift_adjust_manual') { card.remaining_value += args.p_delta; card.is_active = true; return { data: [{ status: 'ok' }], error: null }; }
    return { data: null, error: { message: 'unknown rpc' } };
  },
};
const stripeRefund = async (pi, amount, key) => {
  if (failStripe === pi) throw Object.assign(new Error('card_declined'), { code: 'x' });
  if (!calls.stripe.some(c => c.key === key)) calls.stripe.push({ pi, amount, key });
  return amount ?? 0;
};
const mocks = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/stripe': { stripe: { refunds: { create: async (a, o) => ({ amount: await stripeRefund(a.payment_intent, a.amount, o.idempotencyKey) }) }, paymentIntents: { retrieve: async () => ({}) } } },
  '@/lib/stripe-refund': {
    isAlreadyRefunded: () => false,
    refundOrReleaseHold: async (pi, acct, key) => {
      if (pi === 'pi_held') return { released: true, refundedCents: 0, alreadyRefunded: false };
      const charged = { pi_a: 4525, pi_bal: 2025, pi_tip: 600, pi_pos: 2000 }[pi] ?? 0;
      return { released: false, refundedCents: await stripeRefund(pi, charged, key), alreadyRefunded: false };
    },
  },
  '@/lib/refund-ledger': { refundRecordId: k => `rid:${k}`, recordRefundLedger: async a => { calls.ledger.push(a); const id = `rid:${a.stripeRefundId || a.dedupeKey || a.paymentIntentId}`; if (rows('transactions').some(r => r.id === id)) return 'already'; rows('transactions').push({ id, source: 'refund', payment_intent_id: a.paymentIntentId ?? null, amount: -a.refundedCents / 100, tax: 0, tip: 0 }); return 'recorded'; } },
  '@/lib/ledger-log': { logLedgerSaveFailure: async () => {} },
  '@/lib/payment-notify': { notifyRefundIssued: n => calls.notes.push(n) },
  '@/lib/waitlist-notify-server': { notifyWaitlistForSlot: async () => {} },
  '@/lib/emailer': { sendAppEmail: async (type, data) => { calls.emails.push(data); return {}; } },
};
const { POST } = load('src/app/api/stripe/refund-payment/route.ts', mocks);
const call = async (body, tok = 'owner') => { const r = await POST(new NextRequest('https://clipwise.ca/api', { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(calls)) calls[k] = [];
  failStripe = null;
  tables.shops = [{ id: 'shop', owner_id: 'owner', name: 'Shop', email: 's@x.invalid', slug: 'shop', stripe_account_id: 'acct' }];
  tables.appointments = [
    { id: 'split', shop_id: 'shop', barber_id: 'gill', client_name: 'Jake', client_email: 'j@x.invalid', date: '2026-10-02', status: 'completed', payment_status: 'paid', payment_method: 'gift_card', payment_intent_id: null, total_amount: 40.25, tax_amount: 5.25, tip_amount: 5, gift_applied: 25, balance_due: 0, services: { name: 'Skin Fade' } },
    { id: 'cashv', shop_id: 'shop', barber_id: 'gill', client_name: 'Cash', client_email: null, date: '2026-10-05', status: 'confirmed', payment_status: 'paid', payment_method: 'cash', payment_intent_id: null, total_amount: 30, tax_amount: 3, tip_amount: 0, services: { name: 'Cut' } },
    { id: 'held', shop_id: 'shop', barber_id: null, client_name: 'H', client_email: null, date: '2026-10-05', status: 'confirmed', payment_status: 'paid', payment_method: 'card', payment_intent_id: 'pi_held', total_amount: 30, tax_amount: 0, tip_amount: 0, services: { name: 'Cut' } },
  ];
  tables.transactions = [
    { id: 'bal', shop_id: 'shop', source: 'balance', appointment_id: 'split', payment_method: 'card', payment_intent_id: 'pi_bal', amount: 13.26, tax: 1.99, tip: 5, refunded: false },
    { id: 'cc', shop_id: 'shop', source: 'completion', appointment_id: 'cashv', payment_method: 'cash', payment_intent_id: null, amount: 27, tax: 3, tip: 0, refunded: false },
    { id: 'pos', shop_id: 'shop', source: 'pos', payment_method: 'cash', payment_intent_id: null, amount: 20, tax: 2.6, tip: 0, refunded: false, client_name: 'W', barber_id: 'gill', created_at: '2026-10-03T10:00:00Z' },
    { id: 'gsale', shop_id: 'shop', source: 'gift_card_sale', payment_method: 'card', payment_intent_id: 'pi_gift', amount: 50, tax: 0, tip: 0, refunded: false, service_name: 'Gift Card AB12-CD34', client_name: 'Buyer', barber_id: null, created_at: '2026-10-01T10:00:00Z' },
  ];
  tables.gift_cards = [{ id: 'card', shop_id: 'shop', code: 'AB12-CD34', remaining_value: 30, initial_value: 50, is_active: true }];
}

(async () => {
  // Owner-only.
  seed(); assert.equal((await call({ appointment_id: 'split' }, 'other')).status, 403); assert.equal((await call({ appointment_id: 'split' }, 'nobody')).status, 401);
  // Preview changes nothing and shows each part.
  seed(); let r = await call({ appointment_id: 'split', preview: true });
  assert.equal(r.status, 200); assert.deepEqual(r.j.parts.map(p => `${p.label}:${p.cents}`), ['Balance · Card:2025', 'Gift card:2500']);
  assert.equal(calls.stripe.length, 0); assert.equal(tables.appointments[0].payment_status, 'paid');
  // SPLIT refund: the card part through Stripe, the visit marked refunded (the DB puts the
  // gift value back — phase75), the gift part recorded; customer told how it went back.
  seed(); r = await call({ appointment_id: 'split' });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.refundedCents, 2025, 'money out = the card part only');
  assert.deepEqual(calls.stripe.map(c => c.pi), ['pi_bal'], 'only the card charge goes through Stripe');
  assert.equal(tables.appointments[0].payment_status, 'refunded'); assert.equal(tables.appointments[0].status, 'completed', 'served visit stays');
  assert.deepEqual(calls.ledger.map(l => [l.method, l.refundedCents, l.dedupeKey]), [['card', 2025, null], ['gift_card', 2500, 'gift:split']]);
  assert.equal(calls.ledger.reduce((s, l) => s + l.taxCents, 0), 525, 'tax split adds back to the visit');
  assert.equal(tables.transactions.find(t => t.id === 'bal').refunded, true);
  assert.equal(calls.emails[0].total, '$45.25'); assert.equal(calls.emails[0].breakdown, 'Card $20.25 · Gift card $25.00'); assert.equal(calls.emails[0].cancelled, '');
  assert.match(calls.notes[0].returnedTo, /\$20\.25 to their card, \$25\.00 on their gift card/);
  // Again → nothing left; no second Stripe call.
  r = await call({ appointment_id: 'split' }); assert.equal(r.status, 400); assert.equal(calls.stripe.length, 1);
  // Balance charge already partly refunded in Stripe ($5): the app offers (and refunds) only the rest.
  seed(); tables.transactions.push({ id: 'rid:re_dash', source: 'refund', payment_intent_id: 'pi_bal', amount: -5, tax: 0, tip: 0 });
  r = await call({ appointment_id: 'split', preview: true });
  assert.deepEqual(r.j.parts.map(p => `${p.label}:${p.cents}`), ['Balance · Card:1525', 'Gift card:2500']);
  // Card part fails → nothing changes (visit stays paid, no records, no gift restore).
  seed(); failStripe = 'pi_bal'; r = await call({ appointment_id: 'split' });
  assert.equal(r.status, 500); assert.equal(tables.appointments[0].payment_status, 'paid'); assert.equal(calls.ledger.length, 0);
  // Cash visit: no Stripe; recorded as handed back; unserved booking cancelled.
  seed(); r = await call({ appointment_id: 'cashv' });
  assert.equal(r.status, 200); assert.equal(calls.stripe.length, 0);
  assert.deepEqual(calls.ledger.map(l => [l.method, l.refundedCents, l.dedupeKey, l.taxCents]), [['cash', 3000, 'cash:cashv', 300]]);
  assert.equal(tables.appointments[1].status, 'cancelled'); assert.equal(tables.transactions.find(t => t.id === 'cc').refunded, true);
  // "Paid" but the card was only held → released, not refunded.
  seed(); r = await call({ appointment_id: 'held' });
  assert.deepEqual(r.j, { ok: true, released: true }); assert.equal(tables.appointments[2].payment_status, 'voided'); assert.equal(calls.ledger.length, 0);
  // Cash POS sale: one winner on a double tap.
  seed(); const [x, y] = await Promise.all([call({ transaction_id: 'pos' }), call({ transaction_id: 'pos' })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 400]); assert.equal(calls.ledger.length, 1);
  assert.deepEqual([calls.ledger[0].method, calls.ledger[0].refundedCents, calls.ledger[0].dedupeKey, calls.ledger[0].taxCents], ['cash', 2260, 'cash:pos', 260]);
  // Gift-card sale: only the UNUSED $30 of a $50 card goes back (partial Stripe refund), card voided.
  seed(); r = await call({ transaction_id: 'gsale', preview: true });
  assert.deepEqual(r.j.giftCard, { code: 'AB12-CD34', remainingCents: 3000, initialCents: 5000 }); assert.equal(r.j.parts[0].cents, 3000);
  r = await call({ transaction_id: 'gsale' });
  assert.equal(r.status, 200); assert.equal(r.j.giftCardVoided, true);
  assert.deepEqual(calls.stripe, [{ pi: 'pi_gift', amount: 3000, key: 'refund-gift-pi_gift-3000' }]);
  assert.deepEqual([tables.gift_cards[0].remaining_value, tables.gift_cards[0].is_active], [0, false]);
  assert.deepEqual([calls.ledger[0].method, calls.ledger[0].refundedCents, calls.ledger[0].paymentIntentId], ['card', 3000, 'pi_gift']);
  r = await call({ transaction_id: 'gsale' }); assert.equal(r.status, 400, 'already refunded'); assert.equal(calls.stripe.length, 1);
  // Stripe fails on a gift-card sale → the card's balance is put back, nothing recorded.
  seed(); failStripe = 'pi_gift'; r = await call({ transaction_id: 'gsale' });
  assert.equal(r.status, 500); assert.deepEqual([tables.gift_cards[0].remaining_value, tables.gift_cards[0].is_active], [30, true]); assert.equal(calls.ledger.length, 0);
  // A fully used gift card has nothing to refund.
  seed(); tables.gift_cards[0].remaining_value = 0; r = await call({ transaction_id: 'gsale' }); assert.equal(r.status, 400); assert.equal(calls.stripe.length, 0);

  // Wiring: the Payments page previews then refunds; gift sales store their charge.
  const src = f => fs.readFileSync(path.join(root, f), 'utf8');
  const pay = src('src/app/dashboard/payments/page.tsx');
  assert.match(pay, /JSON\.stringify\(\{ \.\.\.refundBody\(i\), preview: true \}\)/);
  assert.match(pay, /Record cash refund/); assert.match(pay, /Refund gift card & void/);
  assert.match(src('src/lib/finalize-gift-session.ts'), /payment_intent_id: typeof session\.payment_intent === "string"/);
  console.log('PASS refund engine: each part back the way it came in (card → Stripe, cash recorded, gift card → back on the card), split visits add back to their tax/tip, money-out counts only card+cash, preview changes nothing, failed card part changes nothing, held card released, cash double-tap refunds once, gift-card sale refunds only the unused value + voids (and rolls back if Stripe fails), owner-only');
})().catch(e => { console.error(e); process.exitCode = 1; });
