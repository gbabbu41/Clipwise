// THE refund plan — how a payment goes back, part by part, the way it came in
// (owner decision 2026-10-03). Pure (no server imports) so the Payments preview
// and the refund route compute the SAME parts, and tests can prove the split.
//
// An appointment can be paid in up to four kinds of parts:
//   · its own charge — a card (Stripe) or cash,
//   · gift-card value applied at checkout (gift_applied),
//   · balances collected later (source "balance" rows — card on their own charge, or cash),
//   · a tip paid after the visit on its own card charge (a "completion" row with a tip).
// Each part goes back its own way: a card part through Stripe, a cash part is
// recorded as handed back in person, a gift part goes back on the gift card (the
// database does that the moment the visit is marked refunded — phase75).
//
// Tax and tip are split across the parts in proportion to what each covered, so
// the refund records of one visit add back up to exactly its tax and tip. A part
// that already has its refund record is `done` (retries never refund twice).

export type PlanAppt = {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_intent_id?: string | null;
  total_amount?: number | null;   // service + tax
  tax_amount?: number | null;
  tip_amount?: number | null;
  gift_applied?: number | null;
  balance_due?: number | null;
};

export type PlanTx = {
  id: string;
  source?: string | null;
  payment_method?: string | null;
  payment_intent_id?: string | null;
  amount?: number | null;
  tax?: number | null;
  tip?: number | null;
  refunded?: boolean | null;
  appointment_id?: string | null;
  service_name?: string | null;
};

export type RefundPartKind = "card" | "cash" | "gift_card";

export type RefundPart = {
  key: string;                    // the charge id, or "cash:<id>" / "gift:<id>" — one refund record per key
  kind: RefundPartKind;
  label: string;                  // "Card", "Cash", "Gift card", "Balance · Card", "Tip · Card"
  cents: number;                  // what goes back (card parts: Stripe's figure wins at refund time)
  taxCents: number;
  tipCents: number;
  paymentIntentId: string | null; // card parts only
  txIds: string[];                // ledger rows to flag refunded with this part
  done: boolean;                  // its refund record already exists
  blocked?: string;               // why this part can't be refunded from the app
};

const c = (v: number | null | undefined) => Math.round((Number(v) || 0) * 100);
const isRefund = (t: PlanTx) => t.source === "refund";
const rowCents = (t: PlanTx) => c(t.amount) + c(t.tax) + c(t.tip);

/** Split `part` of `whole` by the same ratio as `of` — whole cents, never above `of`. */
const share = (part: number, whole: number, of: number) => (whole > 0 ? Math.min(of, Math.round((part * of) / whole)) : 0);

/** The refund parts of one appointment payment. `doneKeys` = keys whose refund
 *  record already exists (see refundPartsDoneKeys in the route). */
export function planAppointmentRefund(appt: PlanAppt, txs: PlanTx[], doneKeys: Set<string> = new Set()): RefundPart[] {
  const rows = txs.filter(t => !isRefund(t));
  const pi = appt.payment_intent_id ?? null;
  const method = appt.payment_method ?? null;
  const parts: RefundPart[] = [];

  // A tip paid after the visit on its OWN charge — not part of the booking's own payment.
  const tipRows = rows.filter(t => t.source === "completion" && c(t.tip) > 0 && !!t.payment_intent_id && t.payment_intent_id !== pi);
  const balances = rows.filter(t => t.source === "balance" && rowCents(t) > 0);

  const totalC = c(appt.total_amount);
  const taxC = Math.min(totalC, Math.max(0, c(appt.tax_amount)));
  const tipC = tipRows.length ? 0 : Math.max(0, c(appt.tip_amount));
  const dueC = Math.min(totalC, Math.max(0, c(appt.balance_due)));
  const balC = balances.reduce((s, t) => s + rowCents(t), 0);
  const balTax = balances.reduce((s, t) => s + Math.max(0, c(t.tax)), 0);
  const balTip = balances.reduce((s, t) => s + Math.max(0, c(t.tip)), 0);

  // What the booking's own payment covered (its charge / cash / gift value).
  const mainC = Math.max(0, totalC + tipC - dueC - balC);
  const mainTax = Math.max(0, Math.min(mainC, taxC - balTax));
  const mainTip = Math.max(0, Math.min(mainC - mainTax, tipC - balTip));
  const giftC = Math.min(mainC, Math.max(0, c(appt.gift_applied)));
  const payC = method === "gift_card" ? 0 : mainC - giftC;
  const giftTax = share(giftC, mainC, mainTax), giftTip = share(giftC, mainC, mainTip);

  if (payC > 0) {
    const tax = mainTax - giftTax, tip = mainTip - giftTip;
    if (method === "cash") {
      const key = `cash:${appt.id}`;
      parts.push({ key, kind: "cash", label: "Cash", cents: payC, taxCents: tax, tipCents: tip, paymentIntentId: null,
        txIds: rows.filter(t => t.source === "completion" && t.payment_method === "cash" && !t.payment_intent_id).map(t => t.id), done: doneKeys.has(key) });
    } else if (pi) {
      // A no-show's charge is the fee on its ledger row, not the booking total.
      const own = rows.find(t => t.payment_intent_id === pi);
      const noShow = appt.status === "no-show" && own;
      const cents = noShow ? rowCents(own) : payC;
      parts.push({ key: pi, kind: "card", label: noShow ? "No-show fee · Card" : "Card",
        cents, taxCents: noShow ? Math.max(0, c(own.tax)) : tax, tipCents: noShow ? Math.max(0, c(own.tip)) : tip,
        paymentIntentId: pi, txIds: rows.filter(t => t.payment_intent_id === pi).map(t => t.id), done: doneKeys.has(pi) });
    } else {
      parts.push({ key: `card:${appt.id}`, kind: "card", label: "Card", cents: payC, taxCents: tax, tipCents: tip, paymentIntentId: null,
        txIds: [], done: false, blocked: "No card charge on file for this payment — refund it from your Stripe dashboard." });
    }
  }

  for (const t of balances) {
    const cardPi = t.payment_intent_id ?? null;
    const key = cardPi ?? `cash:${t.id}`;
    parts.push({ key, kind: cardPi ? "card" : "cash", label: cardPi ? "Balance · Card" : "Balance · Cash",
      cents: rowCents(t), taxCents: Math.max(0, c(t.tax)), tipCents: Math.max(0, c(t.tip)), paymentIntentId: cardPi,
      txIds: [t.id], done: doneKeys.has(key) });
  }

  for (const t of tipRows) {
    const tipPi = t.payment_intent_id as string;
    parts.push({ key: tipPi, kind: "card", label: "Tip · Card", cents: rowCents(t), taxCents: Math.max(0, c(t.tax)), tipCents: Math.max(0, c(t.tip)),
      paymentIntentId: tipPi, txIds: [t.id], done: doneKeys.has(tipPi) });
  }

  if (giftC > 0) {
    const key = `gift:${appt.id}`;
    parts.push({ key, kind: "gift_card", label: "Gift card", cents: giftC, taxCents: giftTax, tipCents: giftTip, paymentIntentId: null,
      txIds: [], done: doneKeys.has(key) });
  }
  return parts;
}

/** The gift card a gift-card SALE row sold ("Gift Card <CODE>"). */
export function giftSaleCode(t: Pick<PlanTx, "service_name">): string | null {
  const m = /^Gift Card ([A-Z0-9-]+)$/i.exec((t.service_name ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

/** The refund part of one POS / standalone ledger row. A gift-card sale refunds
 *  only the value still unused on the card (`giftRemainingCents`). */
export function planTransactionRefund(tx: PlanTx, doneKeys: Set<string> = new Set(), giftRemainingCents?: number): RefundPart {
  const giftSale = tx.source === "gift_card_sale";
  const pi = tx.payment_intent_id ?? null;
  const full = rowCents(tx);
  const cents = giftSale ? Math.max(0, Math.min(full, giftRemainingCents ?? full)) : full;
  const tax = giftSale ? 0 : Math.max(0, c(tx.tax));
  const tip = giftSale ? 0 : Math.max(0, c(tx.tip));
  const label = giftSale ? "Gift card sale" : "Sale";
  if (tx.payment_method === "cash") {
    const key = `cash:${tx.id}`;
    return { key, kind: "cash", label: `${label} · Cash`, cents, taxCents: tax, tipCents: tip, paymentIntentId: null, txIds: [tx.id], done: doneKeys.has(key) || !!tx.refunded };
  }
  if (!pi) {
    return { key: `card:${tx.id}`, kind: "card", label: `${label} · Card`, cents, taxCents: tax, tipCents: tip, paymentIntentId: null, txIds: [tx.id], done: !!tx.refunded,
      blocked: "No card charge on file for this sale — refund it from your Stripe dashboard." };
  }
  return { key: pi, kind: "card", label: `${label} · Card`, cents, taxCents: tax, tipCents: tip, paymentIntentId: pi, txIds: [tx.id], done: doneKeys.has(pi) || !!tx.refunded };
}

/** Scale a part's tax / tip to what was ACTUALLY refunded (Stripe's figure). */
export function scaleSplit(part: Pick<RefundPart, "cents" | "taxCents" | "tipCents">, actualCents: number): { taxCents: number; tipCents: number } {
  if (part.cents <= 0 || actualCents === part.cents) return { taxCents: part.taxCents, tipCents: part.tipCents };
  const taxCents = share(actualCents, part.cents, part.taxCents);
  return { taxCents, tipCents: Math.min(actualCents - taxCents, share(actualCents, part.cents, part.tipCents)) };
}
