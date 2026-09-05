import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { authorizeShop } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * OWNER-ONLY safety net: find money that hit the shop's Stripe but was never
 * recorded in ClipWise (e.g. a webhook Stripe never delivered). READ-ONLY — it
 * writes nothing, so totals never move on their own; it only surfaces charges for
 * the owner to review.
 *
 * Built to NEVER false-flag:
 *  · Only ClipWise-created Checkout Sessions are considered (they carry our
 *    metadata.flow) — the shop's unrelated Stripe activity is never touched.
 *  · Only the discrete, webhook-recorded REVENUE flows (gift / tip / balance /
 *    payment-link / POS) — booking holds and setup sessions are skipped.
 *  · Each flow is matched EXACTLY to its own record: a gift by its card `code`,
 *    everything else by its PaymentIntent id (stored on the appointment/tx). A
 *    match on ANY of those = recorded = never shown.
 *  · A 20-minute lag buffer so an in-flight payment (webhook still arriving) is
 *    never mistaken for a lost one.
 *  · Each surviving candidate is re-checked against Stripe itself (succeeded,
 *    money actually kept, not refunded) before it's ever shown.
 */

// The webhook-recorded revenue flows. Booking sessions carry no `flow` (and are
// holds / already covered by reconcile-payments), so they're intentionally out.
const REVENUE_FLOWS = new Set([
  "gift_card_purchase", "tip", "balance", "post_booking_payment", "pos_sale", "pos_terminal_sale",
]);

const FLOW_LABEL: Record<string, string> = {
  gift_card_purchase: "Gift card",
  tip: "Tip",
  balance: "Balance",
  post_booking_payment: "Appointment payment",
  pos_sale: "In-store sale",
  pos_terminal_sale: "In-store sale",
};

export async function POST(req: NextRequest) {
  const { shop_id } = (await req.json().catch(() => ({}))) as { shop_id?: string };
  // Owner only — this is a shop-level financial-ops view; barbers never see it
  // (keeps the barber portal free of the owner's reconciliation noise).
  const auth = await authorizeShop(req, shop_id, { ownerOnly: true });
  if ("error" in auth) return auth.error;
  const shop = auth.shop as { id: string; stripe_account_id?: string | null; stripe_connected?: boolean | null };
  const connected = !!(shop?.stripe_account_id && shop.stripe_connected);
  if (!connected) return NextResponse.json({ ok: true, items: [] });

  const opts = { stripeAccount: shop.stripe_account_id! };
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - 45 * 86400;   // look back 45 days
  const lagCutoff = nowSec - 20 * 60;        // ignore anything newer than 20 min

  try {
    // What ClipWise already has on record for this shop — the keys we match on.
    const [{ data: txRows }, { data: apptRows }, { data: giftRows }] = await Promise.all([
      supabaseAdmin.from("transactions").select("payment_intent_id").eq("shop_id", shop.id).not("payment_intent_id", "is", null).limit(5000),
      supabaseAdmin.from("appointments").select("payment_intent_id").eq("shop_id", shop.id).not("payment_intent_id", "is", null).limit(5000),
      supabaseAdmin.from("gift_cards").select("code").eq("shop_id", shop.id).limit(5000),
    ]);
    const knownPIs = new Set<string>();
    for (const r of (txRows ?? []) as { payment_intent_id: string | null }[]) if (r.payment_intent_id) knownPIs.add(r.payment_intent_id);
    for (const r of (apptRows ?? []) as { payment_intent_id: string | null }[]) if (r.payment_intent_id) knownPIs.add(r.payment_intent_id);
    const giftCodes = new Set<string>();
    for (const r of (giftRows ?? []) as { code: string | null }[]) if (r.code) giftCodes.add(r.code);

    // Pull the shop's recent PAID checkout sessions (ClipWise-created ones carry
    // metadata.flow). Bounded to a few pages to stay cheap.
    const candidates: Stripe.Checkout.Session[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 4; page++) {
      const list = await stripe.checkout.sessions.list(
        { limit: 100, created: { gte: windowStart }, ...(startingAfter ? { starting_after: startingAfter } : {}) },
        opts,
      );
      for (const s of list.data) {
        if (s.mode !== "payment") continue;
        if (s.payment_status !== "paid") continue;
        if ((s.created ?? 0) > lagCutoff) continue;                 // still in flight — not lost
        const flow = s.metadata?.flow ?? "";
        if (!REVENUE_FLOWS.has(flow)) continue;                     // not a webhook-recorded revenue flow
        const pi = typeof s.payment_intent === "string" ? s.payment_intent : null;
        const recorded = flow === "gift_card_purchase"
          ? (!!s.metadata?.code && giftCodes.has(s.metadata.code))  // gift → exact card-code match
          : (!!pi && knownPIs.has(pi));                             // everything else → exact PI match
        if (!recorded) candidates.push(s);
      }
      if (!list.has_more) break;
      startingAfter = list.data[list.data.length - 1]?.id;
    }

    // Confirm each survivor against Stripe itself before showing it — real money,
    // succeeded, and not refunded. This is the final guard against a false flag.
    const items: {
      id: string; flow: string; label: string; amountCents: number;
      created: number; email: string | null; name: string | null; last4: string | null;
    }[] = [];
    for (const s of candidates) {
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : null;
      let amountKept = 0;
      let last4: string | null = null;
      try {
        if (pi) {
          const intent = await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] }, opts);
          if (intent.status !== "succeeded") continue;             // never captured / failed → no money kept
          const ch = intent.latest_charge as Stripe.Charge | null;
          if (ch) {
            if (ch.refunded) continue;                             // fully refunded → money returned
            amountKept = Math.max(0, (ch.amount_captured ?? ch.amount ?? 0) - (ch.amount_refunded ?? 0));
            last4 = ch.payment_method_details?.card?.last4 ?? null;
          } else {
            amountKept = intent.amount_received ?? 0;
          }
        } else {
          // No PI on the session (shouldn't happen for these flows) — fall back to
          // the session total so a real payment is never dropped.
          amountKept = s.amount_total ?? 0;
        }
      } catch {
        // Can't confirm it against Stripe → stay silent rather than risk a false flag.
        continue;
      }
      if (amountKept <= 0) continue;
      items.push({
        id: s.id,
        flow: s.metadata?.flow ?? "",
        label: FLOW_LABEL[s.metadata?.flow ?? ""] ?? "Payment",
        amountCents: amountKept,
        created: s.created ?? nowSec,
        email: s.customer_details?.email || s.metadata?.purchaser_email || s.metadata?.client_email || null,
        name: s.metadata?.client_name || s.metadata?.purchaser_name || null,
        last4,
      });
    }

    items.sort((a, b) => b.created - a.created);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "stripe error";
    console.error("[unrecorded-payments] error", { shop_id, msg });
    // Never surface a hard error to the page — a failed check just shows nothing.
    return NextResponse.json({ ok: true, items: [], error: msg });
  }
}
