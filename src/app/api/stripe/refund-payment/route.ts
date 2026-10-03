import { NextRequest, NextResponse } from "next/server";
import { sendAppEmail } from "@/lib/emailer";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyRefundIssued } from "@/lib/payment-notify";
import { recordRefundLedger, refundRecordId } from "@/lib/refund-ledger";
import { logLedgerSaveFailure } from "@/lib/ledger-log";
import { isAlreadyRefunded, refundOrReleaseHold } from "@/lib/stripe-refund";
import { notifyWaitlistForSlot } from "@/lib/waitlist-notify-server";
import { giftSaleCode, planAppointmentRefund, planTransactionRefund, remainingPart, scaleSplit, type PlanTx, type RefundPart } from "@/lib/refund-plan";
import { importChargeRefunds } from "@/lib/refund-import";

/**
 * Refund a payment from the Payments page — every part back the way it came in
 * (lib/refund-plan): card parts through Stripe, cash parts recorded as handed
 * back in person, gift-card value back on the gift card. Handles an appointment
 * (incl. split payments: gift card + card/cash balance, a separately paid tip),
 * a POS / standalone sale (card or cash), and a gift-card SALE (refunds the
 * value still unused and voids the card). Owner-only.
 *
 * `preview: true` returns the parts without changing anything (the confirm modal).
 *
 * Every part writes its dated refund record (lib/refund-ledger) — money out on
 * the refund's day; the sale stays on its own paid day. Marking a visit refunded
 * gives back its loyalty points and gift-card value in the database itself
 * (phase73 / phase75). Retries are safe: a part whose refund record exists is
 * skipped, and Stripe refunds carry idempotency keys.
 */

type Shop = { id: string; name: string | null; email: string | null; slug: string | null; owner_id: string; stripe_account_id: string | null };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const howLabel: Record<RefundPart["kind"], string> = { card: "Card", cash: "Cash", gift_card: "Gift card" };

/** What's already refunded: non-card parts (cash / gift) by their record's id,
 *  card charges by the sum of their refund records — a charge can be refunded in
 *  several parts (some straight in Stripe), so only a FULL sum makes it done.
 *  Chargeback records are not refunds. */
async function refundedSoFar(keys: string[], pis: string[]): Promise<{ done: Set<string>; byPi: Map<string, number> }> {
  const done = new Set<string>(), byPi = new Map<string, number>();
  const plain = keys.filter(k => !pis.includes(k));
  if (plain.length) {
    const byId = new Map(plain.map(k => [refundRecordId(k), k]));
    const { data: rows } = await supabaseAdmin.from("transactions").select("id")
      .eq("source", "refund").in("id", Array.from(byId.keys()));
    for (const r of rows ?? []) { const k = byId.get(r.id as string); if (k) done.add(k); }
  }
  if (pis.length) {
    const { data: rows } = await supabaseAdmin.from("transactions").select("payment_intent_id, amount, tax, tip, service_name")
      .eq("source", "refund").in("payment_intent_id", pis);
    for (const r of (rows ?? []) as { payment_intent_id: string | null; amount: unknown; tax: unknown; tip: unknown; service_name: unknown }[]) {
      if (!r.payment_intent_id || /chargeback/i.test(String(r.service_name ?? ""))) continue;
      const c = Math.abs(Math.round((Number(r.amount) || 0) * 100) + Math.round((Number(r.tax) || 0) * 100) + Math.round((Number(r.tip) || 0) * 100));
      byPi.set(r.payment_intent_id, (byPi.get(r.payment_intent_id) ?? 0) + c);
    }
  }
  return { done, byPi };
}
const applySoFar = (parts: RefundPart[], so: { done: Set<string>; byPi: Map<string, number> }) =>
  parts.map(p => p.paymentIntentId ? remainingPart(p, so.byPi.get(p.paymentIntentId) ?? 0) : { ...p, done: p.done || so.done.has(p.key) });

type CardResult = { kind: "refunded"; cents: number; refundId: string | null } | { kind: "released" } | { kind: "synced"; cents: number };

/** Refund one card charge (what's left of it, or `amountCents` of it). Returns
 *  what Stripe returned + its refund id; "released" when the card was only HELD
 *  (the hold is released, $0 moves); "synced" when Stripe had already refunded it
 *  (e.g. in its dashboard) — then its refunds are imported one by one, by id, and
 *  nothing more is recorded here. */
async function refundCard(pi: string, acct: string, idempotencyKey: string, amountCents?: number): Promise<CardResult> {
  if (amountCents == null) {
    const r = await refundOrReleaseHold(pi, acct, idempotencyKey);
    if (r.released) return { kind: "released" };
    if (r.refundedCents != null) return { kind: "refunded", cents: r.refundedCents, refundId: r.refundId ?? null };
  } else {
    try {
      const refund = await stripe.refunds.create({ payment_intent: pi, amount: amountCents }, { stripeAccount: acct, idempotencyKey });
      if (typeof refund.amount === "number") return { kind: "refunded", cents: refund.amount, refundId: refund.id ?? null };
    } catch (err) {
      if (!isAlreadyRefunded(err)) throw err;
    }
  }
  // Already refunded on Stripe — bring its refunds in exactly (amounts + dates).
  try {
    const p = await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] }, { stripeAccount: acct });
    const ch = p.latest_charge as { id?: string; amount_refunded?: number; refunded?: boolean } | string | null;
    if (ch && typeof ch === "object" && ch.id) {
      const res = await importChargeRefunds({
        chargeId: ch.id, paymentIntentId: pi, account: acct, fullyRefunded: !!ch.refunded,
        amountRefunded: ch.amount_refunded ?? 0, eventCreated: Math.floor(Date.now() / 1000),
      });
      return { kind: "synced", cents: res.recorded.reduce((s, r) => s + r.cents, 0) };
    }
  } catch { /* the charge.refunded webhook brings them in */ }
  return { kind: "synced", cents: 0 };
}

const partView = (p: RefundPart) => ({ key: p.key, kind: p.kind, label: p.label, cents: p.cents, done: p.done, blocked: p.blocked ?? null });

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id, transaction_id, preview } = await request.json().catch(() => ({})) as {
    appointment_id?: string; transaction_id?: string; preview?: boolean;
  };
  if (!appointment_id && !transaction_id) {
    return NextResponse.json({ error: "Missing appointment_id or transaction_id" }, { status: 400 });
  }
  const shopCols = "id, name, email, slug, owner_id, stripe_account_id";

  // ── Appointment refund ──────────────────────────────────────────────────────
  if (appointment_id) {
    const { data: appt } = await supabaseAdmin
      .from("appointments").select("*, services(name)").eq("id", appointment_id).single();
    if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    const { data: shopRow } = await supabaseAdmin.from("shops").select(shopCols).eq("id", appt.shop_id).single();
    const shop = shopRow as Shop | null;
    if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const serviceName = (appt.services as { name: string } | null)?.name ?? null;
    const served = appt.status === "completed" || appt.status === "no-show";

    // A card that was only HELD (never charged): release the hold — $0 moves.
    if (appt.payment_status === "held") {
      if (preview) return NextResponse.json({ ok: true, held: true, parts: [] });
      if (!appt.payment_intent_id || !shop.stripe_account_id) return NextResponse.json({ error: "No card hold to release." }, { status: 400 });
      try {
        const r = await refundOrReleaseHold(appt.payment_intent_id, shop.stripe_account_id, `refund-appt-${appt.payment_intent_id}`);
        if (!r.released) return NextResponse.json({ error: "This card was already charged — reload and refund it again." }, { status: 409 });
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't release the hold" }, { status: 500 });
      }
      await supabaseAdmin.from("appointments")
        .update(served ? { payment_status: "voided" } : { status: "cancelled", payment_status: "voided" }).eq("id", appt.id);
      if (!served) await notifyWaitlistForSlot({ shop_id: appt.shop_id, date: appt.date, barber_id: appt.barber_id }).catch(() => null);
      return NextResponse.json({ ok: true, released: true });
    }

    if (!["paid", "captured", "refunded"].includes(appt.payment_status ?? "")) {
      return NextResponse.json({ error: "This booking has no payment to refund." }, { status: 400 });
    }

    // Every ledger row of this visit: its own charge, balances, a separate tip.
    const txCols = "id, source, payment_method, payment_intent_id, amount, tax, tip, refunded, appointment_id, service_name";
    const [{ data: byAppt }, { data: byPi }] = await Promise.all([
      supabaseAdmin.from("transactions").select(txCols).eq("shop_id", appt.shop_id).eq("appointment_id", appt.id),
      appt.payment_intent_id
        ? supabaseAdmin.from("transactions").select(txCols).eq("shop_id", appt.shop_id).eq("payment_intent_id", appt.payment_intent_id)
        : Promise.resolve({ data: [] as PlanTx[] }),
    ]);
    const txs = Array.from(new Map([...(byAppt ?? []), ...(byPi ?? [])].map(t => [(t as PlanTx).id, t as PlanTx])).values());
    const draft = planAppointmentRefund(appt, txs);
    const parts = applySoFar(draft, await refundedSoFar(draft.map(p => p.key), draft.flatMap(p => p.paymentIntentId ? [p.paymentIntentId] : [])));
    const pending = parts.filter(p => !p.done && p.cents > 0);

    if (preview) {
      return NextResponse.json({ ok: true, parts: parts.map(partView), served, alreadyRefunded: appt.payment_status === "refunded" && !pending.some(p => p.kind !== "gift_card") });
    }
    // A refunded visit can only be continued for a card/cash part that didn't go through.
    if (appt.payment_status === "refunded" && !pending.some(p => p.kind !== "gift_card")) {
      return NextResponse.json({ error: "Already refunded." }, { status: 400 });
    }
    if (!pending.length) return NextResponse.json({ error: "Nothing to refund on this booking." }, { status: 400 });
    const blocked = pending.find(p => p.blocked);
    if (blocked) return NextResponse.json({ error: blocked.blocked }, { status: 400 });
    if (pending.some(p => p.kind === "card") && !shop.stripe_account_id) {
      return NextResponse.json({ error: "This shop's Stripe account isn't connected — can't refund the card part." }, { status: 400 });
    }

    const recordPart = async (p: RefundPart, cents: number, stripeRefundId: string | null = null) => {
      const split = scaleSplit(p, cents);
      const res = await recordRefundLedger({
        shopId: appt.shop_id, barberId: appt.barber_id, clientName: appt.client_name,
        serviceName: p.kind === "gift_card" ? `${serviceName ?? "Payment"} (back on gift card)` : p.label.startsWith("Card") ? serviceName : `${serviceName ?? "Payment"} (${p.label.toLowerCase()})`,
        refundedCents: cents, taxCents: split.taxCents, tipCents: split.tipCents,
        appointmentId: appt.id, paymentIntentId: p.paymentIntentId, method: p.kind, dedupeKey: p.paymentIntentId ? null : p.key,
        stripeRefundId,
      });
      if (p.txIds.length) {
        const { error } = await supabaseAdmin.from("transactions").update({ refunded: true }).in("id", p.txIds).neq("source", "refund");
        if (error) await logLedgerSaveFailure("refund-flag", { shopId: appt.shop_id, appointmentId: appt.id, paymentIntentId: p.paymentIntentId }, error);
      }
      return res;
    };

    // 1. Card parts first — the only ones that can fail. Each records itself the
    //    moment Stripe confirms, so a later failure never loses an earlier refund.
    const back: { kind: RefundPart["kind"]; cents: number }[] = [];
    let failure: string | null = null;
    let releasedHold = false;
    for (const p of pending.filter(x => x.kind === "card")) {
      try {
        const main = p.paymentIntentId === appt.payment_intent_id;
        const got = await refundCard(p.paymentIntentId!, shop.stripe_account_id!, `${main ? "refund-appt" : "refund-tx"}-${p.paymentIntentId}`);
        if (got.kind === "released") { releasedHold = true; continue; }
        if (got.kind === "synced") {
          // Stripe had already refunded it — its refunds were imported by id.
          if (p.txIds.length) await supabaseAdmin.from("transactions").update({ refunded: true }).in("id", p.txIds).neq("source", "refund");
          if (got.cents > 0) back.push({ kind: "card", cents: got.cents });
          continue;
        }
        if (got.cents > 0) { await recordPart(p, got.cents, got.refundId); back.push({ kind: "card", cents: got.cents }); }
      } catch (err) {
        failure = `${p.label} ${dollars(p.cents)}: ${err instanceof Error ? err.message : "refund failed"}`;
        break;
      }
    }
    if (failure && !back.length) return NextResponse.json({ error: failure }, { status: 500 });
    // The card was only held after all (never charged): release, not a refund.
    if (releasedHold && !back.length && pending.every(p => p.kind === "card")) {
      await supabaseAdmin.from("appointments")
        .update(served ? { payment_status: "voided" } : { status: "cancelled", payment_status: "voided" }).eq("id", appt.id);
      if (!served) await notifyWaitlistForSlot({ shop_id: appt.shop_id, date: appt.date, barber_id: appt.barber_id }).catch(() => null);
      return NextResponse.json({ ok: true, released: true });
    }

    // 2. Mark the visit refunded (an upcoming booking is also cancelled so its slot
    //    re-opens). The database gives back its gift-card value + loyalty points.
    await supabaseAdmin.from("appointments")
      .update(served ? { payment_status: "refunded" } : { status: "cancelled", payment_status: "refunded" })
      .eq("id", appt.id).in("payment_status", ["paid", "captured"]);

    // 3. Cash handed back + gift value put back: their dated records. The gift
    //    part's record is normally written by the database the moment the visit
    //    turned refunded (phase76, same id — it also takes the barber's gift-card
    //    cut back), so "already" is the expected answer there; this is the backstop.
    for (const p of pending.filter(x => x.kind !== "card")) {
      const res = await recordPart(p, p.cents);
      if (res === "recorded" || (p.kind === "gift_card" && res === "already")) back.push({ kind: p.kind, cents: p.cents });
    }

    if (!served) await notifyWaitlistForSlot({ shop_id: appt.shop_id, date: appt.date, barber_id: appt.barber_id }).catch(() => null);

    const moneyCents = back.filter(b => b.kind !== "gift_card").reduce((s, b) => s + b.cents, 0);
    const totalCents = back.reduce((s, b) => s + b.cents, 0);
    const how = (["card", "cash", "gift_card"] as const)
      .map(k => ({ k, cents: back.filter(b => b.kind === k).reduce((s, b) => s + b.cents, 0) }))
      .filter(x => x.cents > 0);
    if (totalCents > 0) {
      notifyRefundIssued({
        ownerId: shop.owner_id, barberId: appt.barber_id, shopId: appt.shop_id, clientName: appt.client_name,
        amountCents: totalCents, date: appt.date, returnedTo: how.map(x => `${dollars(x.cents)} ${x.k === "card" ? "to their card" : x.k === "cash" ? "in cash" : "on their gift card"}`).join(", "),
      });
      if (appt.client_email) {
        await sendAppEmail("refund_issued", {
          clientName: appt.client_name, clientEmail: appt.client_email,
          shopName: shop.name ?? "", shopEmail: shop.email ?? "", shopSlug: shop.slug ?? "",
          serviceName: serviceName ?? "Your service", date: appt.date, total: dollars(totalCents),
          cancelled: served ? "" : "1",
          breakdown: how.length > 1 || how[0]?.k !== "card" ? how.map(x => `${howLabel[x.k]} ${dollars(x.cents)}`).join(" · ") : "",
          cardBack: how.some(x => x.k === "card") ? "1" : "",
        }).catch(() => null);
      }
    }
    return NextResponse.json({ ok: true, refundedCents: moneyCents, parts: back, ...(failure ? { partial: true, error: `Part of this refund didn't go through — ${failure}. Refund that part from your Stripe dashboard; the app records it automatically.` } : {}) });
  }

  // ── POS / standalone sale, cash sale, or gift-card sale ─────────────────────
  const { data: txRow } = await supabaseAdmin.from("transactions")
    .select("id, shop_id, source, payment_method, payment_intent_id, refunded, amount, tax, tip, service_name, client_name, barber_id, created_at, appointment_id")
    .eq("id", transaction_id!).single();
  if (!txRow) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  const tx = txRow as PlanTx & { shop_id: string; client_name: string | null; barber_id: string | null; created_at: string | null };
  const { data: shopRow } = await supabaseAdmin.from("shops").select(shopCols).eq("id", tx.shop_id).single();
  const shop = shopRow as Shop | null;
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (tx.source === "refund") return NextResponse.json({ error: "That's a refund record." }, { status: 400 });

  // A gift-card sale refunds only the value still unused on the card, then voids it.
  const giftSale = tx.source === "gift_card_sale";
  type GiftCardRow = { id: string; code: string; remaining_value: number | null; initial_value: number | null };
  let card: GiftCardRow | null = null;
  if (giftSale) {
    const code = giftSaleCode(tx);
    if (code) {
      const { data } = await supabaseAdmin.from("gift_cards").select("id, code, remaining_value, initial_value")
        .eq("shop_id", tx.shop_id).eq("code", code).maybeSingle();
      card = (data as GiftCardRow | null) ?? null;
    }
    if (!card) return NextResponse.json({ error: "Couldn't find the gift card this sale sold." }, { status: 404 });
  }
  const remainingCents = card ? Math.round(Number(card.remaining_value ?? 0) * 100) : undefined;
  const draft = planTransactionRefund(tx, new Set(), remainingCents);
  // A gift-card sale refunds what's unused on the card (locked below); any other
  // sale refunds what's left of its charge (part may already be refunded in Stripe).
  const part = giftSale ? draft
    : applySoFar([draft], await refundedSoFar([draft.key], draft.paymentIntentId ? [draft.paymentIntentId] : []))[0];

  if (preview) {
    return NextResponse.json({ ok: true, parts: [partView(part)], giftCard: card ? { code: card.code, remainingCents, initialCents: Math.round(Number(card.initial_value ?? 0) * 100) } : null, alreadyRefunded: part.done });
  }
  if (part.done) return NextResponse.json({ error: "Already refunded." }, { status: 400 });
  if (part.blocked) return NextResponse.json({ error: part.blocked }, { status: 400 });
  if (part.kind === "card" && !shop.stripe_account_id) return NextResponse.json({ error: "This shop's Stripe account isn't connected." }, { status: 400 });

  let cents = part.cents;
  let stripeRefundId: string | null = null;
  let synced = false;
  if (giftSale) {
    // Lock the card at $0 + void it FIRST (one step) — so the balance can't be
    // spent or refunded twice while the money goes back.
    const { data: r, error } = await supabaseAdmin.rpc("gift_refund_sale", {
      p_shop_id: tx.shop_id, p_gift_card_id: card!.id, p_note: "Gift card sale refunded", p_user_id: user.id,
    });
    if (error) return NextResponse.json({ error: "Couldn't update the gift card." }, { status: 500 });
    const row = (Array.isArray(r) ? r[0] : r) as { refunded?: number; status?: string } | null;
    cents = Math.round(Number(row?.refunded ?? 0) * 100);
    if (cents <= 0) return NextResponse.json({ error: "Nothing left on this gift card to refund — it's been used." }, { status: 400 });
  } else if (part.kind === "cash") {
    // Claim the sale (one winner) so a double tap records one cash refund.
    const { data: claimed } = await supabaseAdmin.from("transactions").update({ refunded: true })
      .eq("id", tx.id).eq("refunded", false).select("id");
    if (!claimed?.length) return NextResponse.json({ error: "Already refunded." }, { status: 400 });
  }

  if (part.kind === "card") {
    try {
      // A gift card never used refunds its whole charge; a part-used one only what's left.
      const saleCents = Math.round(((tx.amount ?? 0) + (tx.tax ?? 0) + (tx.tip ?? 0)) * 100);
      const full = !giftSale || cents >= saleCents;
      const got = await refundCard(part.paymentIntentId!, shop.stripe_account_id!, giftSale ? `refund-gift-${part.paymentIntentId}-${cents}` : `refund-tx-${part.paymentIntentId}`, full ? undefined : cents);
      if (got.kind === "released") throw new Error("This sale was never charged — nothing to refund.");
      if (got.kind === "synced") { synced = true; cents = got.cents; }
      else if (got.cents > 0) { cents = got.cents; stripeRefundId = got.refundId; }
    } catch (err) {
      // Nothing went back — put the gift card's balance back as it was.
      if (giftSale) {
        await supabaseAdmin.rpc("gift_adjust_manual", {
          p_shop_id: tx.shop_id, p_gift_card_id: card!.id, p_delta: cents / 100, p_note: "Refund failed — balance put back", p_user_id: user.id,
        }).then(null, () => null);
      }
      return NextResponse.json({ error: err instanceof Error ? err.message : "Refund failed" }, { status: 500 });
    }
    await supabaseAdmin.from("transactions").update({ refunded: true }).eq("id", tx.id);
  }
  if (giftSale && part.kind === "cash") await supabaseAdmin.from("transactions").update({ refunded: true }).eq("id", tx.id);

  // A no-show fee (or any charge) on a booking: the booking's money is refunded too.
  if (part.paymentIntentId) {
    await supabaseAdmin.from("appointments").update({ payment_status: "refunded" })
      .eq("payment_intent_id", part.paymentIntentId).neq("payment_status", "refunded").in("status", ["completed", "no-show"])
      .then(null, () => null);
  }

  // (Already refunded in Stripe → its refunds were imported by id; nothing more to record.)
  if (!synced) {
    const split = scaleSplit(part, cents);
    await recordRefundLedger({
      shopId: tx.shop_id, barberId: tx.barber_id, clientName: tx.client_name, serviceName: tx.service_name ?? null,
      refundedCents: cents, taxCents: split.taxCents, tipCents: split.tipCents,
      appointmentId: tx.appointment_id ?? null, paymentIntentId: part.paymentIntentId, method: part.kind,
      dedupeKey: part.paymentIntentId ? null : part.key, stripeRefundId,
    });
  }

  notifyRefundIssued({
    ownerId: shop.owner_id, barberId: tx.barber_id, shopId: tx.shop_id, clientName: tx.client_name,
    amountCents: cents, date: typeof tx.created_at === "string" ? tx.created_at.slice(0, 10) : null,
    returnedTo: part.kind === "cash" ? "in cash" : "to their card",
  });
  return NextResponse.json({ ok: true, refundedCents: cents, giftCardVoided: giftSale || undefined });
}
