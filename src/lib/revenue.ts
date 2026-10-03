// Shared "collected revenue" math so the Dashboard and the Payments page agree
// to the penny. This MIRRORS the feed/de-dup logic in
// src/app/dashboard/payments/page.tsx (the source of truth, wired to Stripe +
// the transactions ledger). If that logic changes, update both.
//
// Model: gross COLLECTED = settled appointments (paid/captured) + settled POS
// transactions (gift-card sales, product/walk-in sales, no-show fees), with
// transactions de-duped against appointments so a card charge isn't counted
// twice. Given the Stripe `byPi` map (paymentIntent -> {gross, fee, net}) it
// also returns the exact NET after Stripe fees and the total fees paid. Cash
// never touches Stripe, so it carries no fee (net === gross for cash).
//
// REFUNDS (owner rule 2026-10-02 — "a statement, not a rewrite"): a sale counts
// on the day it was PAID even if it's refunded later, and the refund is its own
// NEGATIVE entry on the day the money went back (the source "refund" ledger row,
// lib/refund-ledger). So a past day never changes after the fact, and a refund
// shows where it happened. Stripe keeps its fee on a refund, so the original fee
// stays a cost and the refund takes back the full amount from net. Every refunded
// charge has its refund row (refunds made before refund rows existed were given
// one dated at the sale — phase74 — so those old days read exactly as before).

export type RevAppt = {
  id?: string;                    // links separately-paid tips / collected balances
  client_name: string | null;
  total_amount: number | null;   // service + tax (NOT tip — tip is its own column)
  tax_amount?: number | null;
  tip_amount?: number | null;     // booking tip, charged on the SAME intent
  gift_applied?: number | null;   // gift-card value applied — already counted at sale
  balance_due?: number | null;    // uncollected part of total_amount (partial capture)
  payment_status?: string | null;
  payment_method?: string | null;
  payment_intent_id?: string | null;
  status?: string | null;
  barber_id?: string | null;      // who performed it — used to split owner-barber tips
};

export type RevTx = {
  id?: string;                    // de-duplicates a row seen in both window and evidence
  client_name: string | null;
  service_name?: string | null;
  amount: number | null;
  tip?: number | null;
  tax?: number | null;
  payment_method: string | null;
  created_at: string;
  payment_intent_id?: string | null;
  stripe_session_id?: string | null;
  source?: string | null;
  refunded?: boolean | null;
  appointment_id?: string | null; // the booking a completion/balance row belongs to
  // Barber attribution + stored cut — used by shopBarberCommission so the owner
  // screens read commission from the same ledger the barber portal does.
  barber_id?: string | null;
  commission_amount?: number | null;
};

// paymentIntent id -> exact figures from Stripe balance transactions.
export type ByPi = Record<string, { gross: number; fee: number; net: number }>;

/** Saved gross per PaymentIntent: the first card ledger CHARGE row for that intent
 * (amount + tax + tip) — refunded or not (a refunded sale still happened; its
 * refund is a separate row). Charge rows are written from what Stripe actually
 * took (capture rows use amount_received), so this — not the booking total — is
 * the reliable "Gross collected" for the charge, whether its fee is confirmed or
 * still estimated. */
export function savedChargeGross(txs: RevTx[]): Map<string, number> {
  const saved = new Map<string, number>();
  for (const t of txs) {
    const pi = t.payment_intent_id;
    if (!pi || saved.has(pi) || t.payment_method !== "card" || isRefundRow(t)) continue;
    const g = transactionCollectedAmount(t);
    if (g > 0) saved.set(pi, g);
  }
  return saved;
}

/** Bookings whose tip was paid on its OWN charge (post-visit tip link: a
 * completion row for the booking on a different intent). Older code also copied
 * that tip into the booking's tip_amount, so counting it on the booking as well
 * would count it twice — callers treat these bookings' tip_amount as 0. */
export function separatelyTippedAppts(appts: RevAppt[], txs: RevTx[]): Set<string> {
  const piById = new Map<string, string | null>();
  for (const a of appts) if (a.id) piById.set(a.id, a.payment_intent_id ?? null);
  const ids = new Set<string>();
  for (const t of txs) {
    const id = t.appointment_id;
    if (!id || t.source !== "completion" || !((t.tip ?? 0) > 0) || !piById.has(id)) continue;
    if (t.payment_intent_id && t.payment_intent_id !== piById.get(id)) ids.add(id);
  }
  return ids;
}

/** Balances collected later on a booking (source "balance", own charge or cash),
 * summed per booking. Each balance counts as income on its OWN date, so a booking
 * that falls back to its booking amount must not include them again. */
export function collectedBalances(txs: RevTx[]): Map<string, number> {
  const byAppt = new Map<string, number>();
  for (const t of txs) {
    if (t.source !== "balance" || !t.appointment_id) continue;
    const amt = transactionCollectedAmount(t);
    if (amt > 0) byAppt.set(t.appointment_id, (byAppt.get(t.appointment_id) ?? 0) + amt);
  }
  return byAppt;
}

const rowKey = (t: RevTx) => t.id ?? [t.payment_intent_id, t.source, t.created_at, t.amount, t.tax, t.tip, t.appointment_id].join("|");

export type GrossContext = { saved: Map<string, number>; sepTipped: Set<string>; balances: Map<string, number>; byPi?: ByPi; paidAhead: Set<string> };
/** Everything the collected-gross rule needs, built once per screen/report.
 * `evidence` = ledger rows LINKED to the report's bookings (same payment id or
 * same booking) loaded regardless of the report's date window. It is only ever
 * looked up — never counted as income — so date semantics stay the same. */
export function grossContext(appts: RevAppt[], txs: RevTx[], byPi?: ByPi, evidence: RevTx[] = []): GrossContext {
  const seen = new Set<string>();
  const rows: RevTx[] = [];
  for (const t of [...txs, ...evidence]) { const k = rowKey(t); if (!seen.has(k)) { seen.add(k); rows.push(t); } }
  return { saved: savedChargeGross(rows), sepTipped: separatelyTippedAppts(appts, rows), balances: collectedBalances(rows), byPi, paidAhead: paidAheadPis(rows) };
}

/** Charges recorded as the booking's OWN payment (its "completion" line) — so a
 *  later no-show on that booking was paid in advance, not charged a no-show fee. */
export function paidAheadPis(txs: RevTx[]): Set<string> {
  const pis = new Set<string>();
  for (const t of txs) if (t.source === "completion" && t.payment_intent_id) pis.add(t.payment_intent_id);
  return pis;
}

/**
 * Is this booking's money its NO-SHOW FEE line (and so not the booking itself)?
 * A no-show charged a fee from a held card is "captured" and the fee has its own
 * ledger row (source "no_show") — counted there, so the booking is skipped. A
 * booking PAID IN ADVANCE that then no-shows keeps its own payment: the shop
 * keeps that money (owner decision 2026-10-03), so it still counts here — the
 * barber earns no commission on it (lib/barber-earnings isNoShowEarning).
 */
export function noShowFeeVisit(a: Pick<RevAppt, "status" | "payment_status" | "payment_intent_id">, paidAhead?: Set<string>): boolean {
  if (a.status !== "no-show") return false;
  if (a.payment_status === "paid") return false;   // paid in advance (card online, gift card, cash)
  if (a.payment_status === "refunded") return !(a.payment_intent_id && paidAhead?.has(a.payment_intent_id));
  return true;                                      // "captured" no-show fee
}

/** THE collected-gross rule for one paid booking, shared by every screen and
 * report (Payments, Dashboard, Analytics + its chart, Tax page, weekly email):
 * what its own charge took — the confirmed Stripe gross, else the saved ledger
 * amount — whether the fee is confirmed or estimated. Only a booking with no
 * saved charge (cash, or no ledger row) falls back to the booking amount
 * (service + tax − gift − balance still due − balances collected on their own
 * dates, + tip unless paid on its own charge). Booking ids never change which
 * rule applies; they only link a booking to its separate tip/balance rows. */
export function appointmentGross(a: RevAppt, ctx: GrossContext): { gross: number; tip: number; fromCharge: boolean } {
  const total = a.total_amount ?? 0;
  const bal = Math.min(Math.max(0, a.balance_due ?? 0), total);
  const later = a.id ? ctx.balances.get(a.id) ?? 0 : 0;
  const gift = Math.max(0, a.gift_applied ?? 0);
  const svcTax = Math.max(0, total - bal - gift - later);
  const tip = a.id && ctx.sepTipped.has(a.id) ? 0 : Math.max(0, a.tip_amount ?? 0);
  // A gift card at checkout can cover the tip too — that part isn't new money either.
  const giftOnTip = Math.max(0, gift - Math.max(0, total - bal - later));
  const pi = a.payment_intent_id;
  const charged = pi && a.payment_method !== "cash" ? (ctx.byPi?.[pi]?.gross ?? ctx.saved.get(pi)) : undefined;
  return charged !== undefined ? { gross: charged, tip, fromCharge: true } : { gross: svcTax + Math.max(0, tip - giftOnTip), tip, fromCharge: false };
}

export const isPaid = (s: string | null | undefined) => s === "paid" || s === "captured";
/** A charge that HAPPENED — paid / captured, or paid and LATER refunded. Revenue
 * counts it on its paid day; its refund row subtracts on the refund's day. */
export const isSale = (s: string | null | undefined) => isPaid(s) || s === "refunded";
/** The dated record of money handed back (negative amounts, lib/refund-ledger). */
export const isRefundRow = (t: Pick<RevTx, "source">) => t.source === "refund";
/** The gift-card part of a refund (phase75): the value went back ON the gift card,
 * so no money moved — it was counted when the card was sold, and the visit's
 * gross never included it. It only takes back the tax / tip that part covered. */
export const isGiftRefundRow = (t: Pick<RevTx, "source" | "payment_method">) => isRefundRow(t) && t.payment_method === "gift_card";
/** The service a refund row belongs to: "Refund — Skin Fade (back on gift card)" → "Skin Fade". */
export const refundServiceKey = (name: string | null | undefined) => (name ?? "")
  .replace(/^Refund\s*—\s*/, "")
  .replace(/\s*\(no-show\)$/i, "")
  .replace(/\s*\((?:back on gift card|cash|balance · (?:card|cash)|tip · card|no-show fee · card|refund date not recorded; dated at sale)\)$/i, "")
  .trim();
/** What a refund row gave back (incl. tax + tip), as a positive number. */
export const refundedAmount = (t: Pick<RevTx, "amount" | "tax" | "tip">) => Math.abs(transactionCollectedAmount(t));
export const isNoShowTx = (t: RevTx) => t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee");

/** Ledger amount is before tax; customer collections include tax and tips. */
export function transactionCollectedAmount(t: Pick<RevTx, "amount" | "tax" | "tip">): number {
  return (t.amount ?? 0) + (t.tax ?? 0) + (t.tip ?? 0);
}

/**
 * The ONE rule for which transactions count as income (used by both the
 * Dashboard and the Payments page so they can never disagree). De-dups txs
 * against paid appointments (same client|amount) and drops completion-source
 * txs — the appointment already represents that charge.
 */
export function countablePosTxs<T extends RevTx>(appts: RevAppt[], txs: T[]): T[] {
  const paidSig = new Set(
    appts.filter(a => isSale(a.payment_status)).map(a => `${a.client_name}|${a.total_amount}`),
  );
  return txs.filter(t => {
    if (isNoShowTx(t)) return true;
    if (t.source === "completion") return false;
    // A "balance" tx is a later collection on an appointment whose card charge fell
    // short — its money is added via a dedicated loop in collectedTotals (and the
    // appointment counts its full total once balance_due hits 0), so it must NOT
    // also count here as a standalone POS sale.
    if (t.source === "balance") return false;
    // A "refund" tx is money handed back, not a sale — collectedTotals subtracts
    // it on its own day in a dedicated loop, so it is never counted as income here.
    if (isRefundRow(t)) return false;
    if (!t.source && !t.stripe_session_id && paidSig.has(`${t.client_name}|${t.amount}`)) return false;
    return true;
  });
}

/**
 * Net + fee for one charge line, the ONE place Stripe fees are applied. A card
 * charge with a matching Stripe balance-txn uses the exact net/fee; everything
 * else (cash, or not-yet-synced) nets to its gross with no fee.
 */
export function lineNetFee(pi: string | null | undefined, gross: number, byPi?: ByPi): { net: number; fee: number } {
  const b = pi && byPi ? byPi[pi] : undefined;
  return b ? { net: b.net, fee: b.fee } : { net: gross, fee: 0 };
}

// ESTIMATED card fee — used ONLY as a fallback to keep Net computable while the
// REAL fee is still settling, or for an old charge whose fee was never recorded
// (see KNOWLEDGE-BOOK §3.8). A confirmed fee (live Stripe or a recorded ledger
// fee > 0) always wins; a stored 0 means "not captured yet" → estimated. The rate
// is a platform setting (super-admin, Platform Settings → Fee estimates; default
// Stripe's standard CAD card rate 2.9% + $0.30). It never touches a confirmed fee
// or a customer charge. Real Stripe fees vary by payment type (international
// cards, Interac…), so an estimate can land above or below. Rounded UP to the cent.
export const DEFAULT_CARD_FEE_ESTIMATE = { percent: 2.9, fixed: 0.3 } as const;
export type CardFeeEstimate = { percent: number; fixed: number };
export function estimateStripeFee(grossDollars: number, rate?: CardFeeEstimate | null): number {
  if (!(grossDollars > 0)) return 0;
  const ok = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
  const percent = ok(rate?.percent, 10) ? rate!.percent : DEFAULT_CARD_FEE_ESTIMATE.percent;
  const fixed = ok(rate?.fixed, 2) ? rate!.fixed : DEFAULT_CARD_FEE_ESTIMATE.fixed;
  // Whole cents (gross $ × percent = cents) so 2.9% doesn't pick up float drift.
  return Math.ceil(grossDollars * percent + fixed * 100 - 1e-6) / 100;
}

export type CollectedTotals = {
  gross: number;   // everything collected, incl. tax + tips, before Stripe fees
  fees: number;    // total Stripe processing fees (card only)
  net: number;     // gross − fees (what actually lands; cash unaffected)
  tax: number;     // tax portion of gross (informational — owed to govt)
  cash: number;    // cash portion of gross (no fee)
  tips: number;    // tips collected (the barber's money, but it landed in the shop's Stripe)
  ownerTips: number; // subset of `tips` earned by the OWNER-barber — their own money,
                     // not paid out, so it stays in the owner's net revenue
  preTax: number;  // gross − tax
  refunds: number; // money handed back in this window (already subtracted from gross/net/tax/tips)
};

/**
 * Total collected across appointments + transactions for whatever slice the
 * caller passes in (already date-filtered). Pass the Stripe `byPi` map to get
 * exact net/fees; omit it and net === gross (fees 0). `evidence` = ledger rows
 * linked to these bookings loaded outside the window (see grossContext) — looked
 * up for each booking's charge/tip/balance links, NEVER counted as income.
 */
export function collectedTotals(appts: RevAppt[], txs: RevTx[], byPi?: ByPi, ownerBarberId?: string | null, evidence: RevTx[] = []): CollectedTotals {
  // Same income rule the Payments page uses (shared, so they can't disagree).
  const posTxs = countablePosTxs(appts, txs);

  let gross = 0, fees = 0, net = 0, tax = 0, cash = 0, tips = 0, ownerTips = 0, refunds = 0;
  // A tip belongs to the barber who earned it. The OWNER-barber's own tips are the
  // owner's money (like their 0-commission chair), so they're tracked separately
  // and NOT subtracted from the owner's net revenue.
  const isOwnerBarber = (barberId: string | null | undefined) => !!ownerBarberId && barberId === ownerBarberId;

  // PaymentIntents accounted for by the appointment loop — a post-visit tip on
  // one of these intents is already inside the appointment, so it's skipped below.
  const apptPis = new Set<string>();
  // Gross = what each charge actually took (confirmed Stripe gross, else the saved
  // ledger amount), never the booking total: an uncaptured remainder isn't
  // collected, and a tip paid on its own charge is counted once (its own line).
  const ctx = grossContext(appts, txs, byPi, evidence);

  // Settled appointments — exclude no-shows whose money is their no-show FEE row
  // (counted below, so it isn't double-counted). A no-show paid in advance keeps
  // its own payment (noShowFeeVisit).
  for (const a of appts) {
    if (!isSale(a.payment_status)) continue;   // a later refund is its own row below
    if (noShowFeeVisit(a, ctx.paidAhead)) continue;
    // The customer paid: (service + tax) − gift already applied + the booking tip.
    //  · Subtract gift: that value was counted when the card was SOLD, so counting
    //    the full total here would double-count it (total_amount stays full for the
    //    receipt).
    //  · ADD the tip into gross (it rode the same charge). Without this, gross
    //    excluded the tip while net (from the real Stripe charge) included it — so
    //    net could read HIGHER than gross. Now gross ≥ net always, and every tip
    //    is counted consistently (same as POS + post-visit tips).
    // Only the COLLECTED part counts. A partial capture (a price raised above the
    // held card) leaves `balance_due` of the service+tax still owed — subtract it,
    // and scale the tax to the collected fraction. 0/absent balance_due behaves
    // exactly like a fully-collected appointment (no change for the common case).
    const total = a.total_amount ?? 0;
    const bal = Math.min(Math.max(0, a.balance_due ?? 0), total);
    const collectedSvcTax = Math.max(0, total - bal);
    const pi = a.payment_intent_id;
    const { gross: lineGross, tip: apptTip } = appointmentGross(a, ctx);
    const { net: n, fee: f } = lineNetFee(pi, lineGross, byPi);
    gross += lineGross; net += n; fees += f;
    // Tax keeps its existing rule (booking tax scaled by recorded balance_due) —
    // it feeds "tax to remit" + Net revenue, so the Gross fix doesn't change it.
    tax += total > 0 ? (a.tax_amount ?? 0) * (collectedSvcTax / total) : (a.tax_amount ?? 0);
    tips += apptTip;
    if (isOwnerBarber(a.barber_id)) ownerTips += apptTip;
    if (a.payment_method === "cash") cash += lineGross;
    if (a.payment_intent_id) apptPis.add(a.payment_intent_id);
  }

  // POS ledger amount excludes tax. Count tax once in collections, then expose
  // it separately for the owner's tax deduction (not a second deduction).
  for (const t of posTxs) {
    const amt = transactionCollectedAmount(t);   // refunded later? its refund row subtracts below
    const { net: n, fee: f } = lineNetFee(t.payment_intent_id, amt, byPi);
    gross += amt; net += n; fees += f;
    tax += t.tax ?? 0;
    tips += t.tip ?? 0;
    if (isOwnerBarber(t.barber_id)) ownerTips += t.tip ?? 0;
    if (t.payment_method === "cash") cash += amt;
  }

  // Post-visit tips (the tip-link flow). These are `completion` transactions
  // that countablePosTxs drops, so the tip — real money that hit the shop's
  // Stripe — was previously counted NOWHERE on the owner side (it only showed in
  // the barber portal). A post-visit tip has its OWN PaymentIntent (not one of a
  // counted appointment), so we can add it to gross + net cleanly. A booking tip
  // shares the appointment's intent (pi ∈ apptPis) and is already inside that
  // appointment's net, so we skip it here to avoid double-counting.
  for (const t of txs) {
    if (t.source !== "completion") continue;
    if (t.payment_method === "gift_card") continue;   // a gift-card visit's earnings line — its value was counted when the card was sold
    const tip = t.tip ?? 0;
    if (tip <= 0) continue;
    const pi = t.payment_intent_id ?? null;
    if (pi && apptPis.has(pi)) continue; // booking tip — already in the appt net
    gross += tip; tips += tip;
    if (isOwnerBarber(t.barber_id)) ownerTips += tip;
    const { net: n, fee: f } = lineNetFee(pi, tip, byPi);
    net += n; fees += f;
    if (t.payment_method === "cash") cash += tip;
  }

  // Collected BALANCES (source "balance") — money taken later on an appointment
  // whose card charge fell short (a price raised above the hold). Each balance is
  // income on its OWN date: the booking line above counts only its own charge (or
  // its booking amount minus balances collected later), so the balance adds its
  // own gross + net + fee here — gross − fees = net, nothing counted twice. Tax
  // keeps its existing rule (booked on the appointment).
  for (const t of txs) {
    if (t.source !== "balance") continue;
    const amt = (t.amount ?? 0) + (t.tax ?? 0) + (t.tip ?? 0);
    if (amt <= 0) continue;
    const { net: n, fee: f } = lineNetFee(t.payment_intent_id ?? null, amt, byPi);
    net += n; fees += f;
    gross += amt;
    if (t.payment_method === "cash") cash += amt;
  }

  // REFUNDS — money handed back, on the day it went back. The whole amount comes
  // off gross AND net (Stripe keeps its original fee, which stays in `fees`); the
  // tax and tip given back come off tax / tips. A window can go negative (a
  // refund-only day) — that's the truth, not an error.
  for (const t of txs) {
    if (!isRefundRow(t)) continue;
    const back = refundedAmount(t);
    if (back <= 0) continue;
    // Gift-card part: no money out (see isGiftRefundRow) — only its tax / tip come back.
    if (!isGiftRefundRow(t)) { gross -= back; net -= back; refunds += back; }
    tax -= Math.abs(t.tax ?? 0);
    const tipBack = Math.abs(t.tip ?? 0);
    tips -= tipBack;
    if (isOwnerBarber(t.barber_id)) ownerTips -= tipBack;
    if (t.payment_method === "cash") cash -= back;
  }

  return { gross, fees, net, tax, cash, tips, ownerTips, preTax: gross - tax, refunds };
}
