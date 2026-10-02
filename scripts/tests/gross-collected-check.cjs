const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
function load(file) {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename; m.require = req;
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}
const { collectedTotals, savedChargeGross, separatelyTippedAppts } = load('src/lib/revenue.ts');
const { confirmedFeesFromRows } = load('src/lib/confirmed-fees.ts');
const cents = n => Math.round(n * 100) / 100;
const reconciles = t => assert.equal(cents(t.gross - t.fees), cents(t.net), `gross − fees = net (${t.gross} − ${t.fees} vs ${t.net})`);
const at = '2026-09-04T03:43:21Z';
const appt = o => ({ id: 'a1', client_name: 'C', payment_status: 'captured', payment_method: 'card', status: 'completed', tax_amount: 0, tip_amount: 0, gift_applied: 0, balance_due: null, ...o });
const row = o => ({ client_name: 'C', amount: 0, tax: 0, tip: 0, payment_method: 'card', created_at: at, refunded: false, source: 'completion', ...o });
const feeRows = rows => confirmedFeesFromRows(rows.map((r, i) => ({ id: `r${i}`, stripe_fee: r.fee ?? 0, ...r })));

// 1. Tip paid on its OWN charge while the booking still carries tip_amount (legacy) → counted once.
{
  const appts = [appt({ id: 'aug7', total_amount: 35, tip_amount: 5.25, payment_intent_id: 'pi_svc' })];
  const txs = [row({ appointment_id: 'aug7', payment_intent_id: 'pi_svc', amount: 35, fee: 1.6 }),
               row({ appointment_id: 'aug7', payment_intent_id: 'pi_tip', amount: 0, tip: 5.25, fee: 0.49 })];
  assert(separatelyTippedAppts(appts, txs).has('aug7'));
  const t = collectedTotals(appts, txs, feeRows(txs));
  assert.equal(cents(t.gross), 40.25, 'service charge + separate tip once (was 45.50)');
  assert.equal(cents(t.tips), 5.25, 'tip counted once');
  assert.equal(cents(t.net), 38.16); reconciles(t);
  // Fees not yet known → Gross still the saved amounts.
  assert.equal(cents(collectedTotals(appts, txs).gross), 40.25);
}

// 2. Booking total raised above what was captured, no balance recorded → only the capture is collected.
{
  const appts = [appt({ id: 'sep4', total_amount: 74.75, tax_amount: 9.75, payment_intent_id: 'pi_cap' })];
  const txs = [row({ appointment_id: 'sep4', payment_intent_id: 'pi_cap', amount: 35, tax: 5.25, fee: 1.79 })];
  const t = collectedTotals(appts, txs, feeRows(txs));
  assert.equal(cents(t.gross), 40.25, 'uncaptured $34.50 not collected (was 74.75)');
  assert.equal(cents(t.tax), 9.75, 'tax rule unchanged (known gap: uncaptured share still counted)');
  assert.equal(cents(t.net), 38.46); reconciles(t);
  assert.equal(cents(collectedTotals(appts, txs).gross), 40.25, 'same without confirmed fees');
}

// 3. Split payment: capture + balance collected later (card) → full total once, tax once.
{
  const appts = [appt({ id: 'split', total_amount: 74.75, tax_amount: 9.75, balance_due: 0, payment_intent_id: 'pi_cap' })];
  const txs = [row({ appointment_id: 'split', payment_intent_id: 'pi_cap', amount: 35, tax: 5.25, fee: 1.79 }),
               row({ appointment_id: 'split', payment_intent_id: 'pi_bal', source: 'balance', amount: 30, tax: 4.5, fee: 1.3 })];
  const t = collectedTotals(appts, txs, feeRows(txs));
  assert.equal(cents(t.gross), 74.75); assert.equal(cents(t.tax), 9.75); reconciles(t);
  // Cash balance: same gross, cash counted.
  const cashTxs = [txs[0], { ...txs[1], payment_method: 'cash', payment_intent_id: null }];
  const c = collectedTotals(appts, cashTxs, feeRows(cashTxs));
  assert.equal(cents(c.gross), 74.75); assert.equal(cents(c.cash), 34.5); reconciles(c);
}

// 4. Gift card covers part → only the card portion is card gross; tax unchanged (existing rule).
{
  const appts = [appt({ id: 'gift', total_amount: 50, tax_amount: 5, gift_applied: 20, payment_intent_id: 'pi_g' })];
  const txs = [row({ appointment_id: 'gift', payment_intent_id: 'pi_g', amount: 25, tax: 5, fee: 1.17 })];
  const t = collectedTotals(appts, txs, feeRows(txs));
  assert.equal(cents(t.gross), 30); assert.equal(cents(t.tax), 5); reconciles(t);
}

// 5. Booking tip on the SAME charge still counts (saved row includes it); refunds and cash unchanged.
{
  const appts = [appt({ id: 'tip', total_amount: 40, tip_amount: 6, payment_intent_id: 'pi_t' }),
                 appt({ id: 'ref', total_amount: 30, payment_status: 'refunded', payment_intent_id: 'pi_r' }),
                 appt({ id: 'cash', total_amount: 25, payment_method: 'cash', payment_status: 'paid', payment_intent_id: null })];
  const txs = [row({ appointment_id: 'tip', payment_intent_id: 'pi_t', amount: 40, tip: 6, fee: 1.64 })];
  const t = collectedTotals(appts, txs, feeRows(txs));
  // A refunded sale still counts on its paid day (owner rule 2026-10-02) — 46 + 30 + 25.
  assert.equal(cents(t.gross), 101); assert.equal(cents(t.tips), 6); assert.equal(cents(t.cash), 25); reconciles(t);
  // Its refund row (money out, on the refund's day) brings the pair back to zero.
  const withRefund = collectedTotals(appts, [...txs, row({ source: 'refund', refunded: true, appointment_id: 'ref', payment_intent_id: 'pi_r', amount: -30 })], feeRows(txs));
  assert.equal(cents(withRefund.gross), 71); assert.equal(cents(withRefund.refunds), 30); reconciles(withRefund);
}

// 6. Loyalty/discounted POS sale: ledger amount is already net of the discount → unchanged.
{
  const txs = [row({ source: 'pos', payment_intent_id: 'pi_pos', amount: 27, tax: 4.05, fee: 1.2 })];
  const t = collectedTotals([], txs, feeRows(txs));
  assert.equal(cents(t.gross), 31.05); reconciles(t);
}

// 7. Missing booking ids never select a different calculation: same saved-charge rule.
{
  const appts = [{ ...appt({ total_amount: 74.75, tax_amount: 9.75, payment_intent_id: 'pi_cap' }), id: undefined }];
  const txs = [row({ payment_intent_id: 'pi_cap', amount: 35, tax: 5.25, fee: 1.79 })];
  assert.equal(cents(collectedTotals(appts, txs).gross), 40.25);
  assert.equal(cents(collectedTotals(appts, txs).tax), 9.75, 'tax unchanged');
  assert.equal(savedChargeGross(txs).get('pi_cap'), 40.25);
}

console.log('PASS gross collected: saved charge amounts, separate tips once, uncaptured excluded, split/gift/loyalty/refund/cash preserved, gross − fees = net');
