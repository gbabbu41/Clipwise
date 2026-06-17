import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTwilio, twilioSender, toE164 } from "@/lib/twilio";
import { sendPaymentReceipt, notifyChargeFailed, notifyNoShowCharged } from "@/lib/payment-notify";
import { prettyDate } from "@/lib/utils";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// POST /api/cron/no-show  (run every ~30 min; needs x-cron-secret)
// Auto-charges the held card for appointments a client didn't show up to
// (still pending/confirmed ~2h after their time) when the shop has no-show
// protection on, then SMSes the client. Never throws — bad rows are skipped.
const GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours after the slot

function slotToDate(date: string, slot: string): Date | null {
  const m = slot?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  const d = new Date(`${date}T${String(h).padStart(2, "0")}:${m[2]}:00`);
  return isNaN(d.getTime()) ? null : d;
}

// Accept Vercel Cron (GET + Authorization: Bearer CRON_SECRET) and external
// schedulers (POST + x-cron-secret).
function authorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return true; // unset = allow (local dev)
  return req.headers.get("x-cron-secret") === s || req.headers.get("authorization") === `Bearer ${s}`;
}

async function run() {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Open appointments with a card on hold (held) or on file (saved, for
  // bookings >7 days out), dated today or earlier.
  const { data: rows } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, client_email, client_phone, date, time_slot, total_amount, payment_intent_id, payment_status, stripe_customer_id, stripe_payment_method_id")
    .in("payment_status", ["held", "saved"])
    .in("status", ["pending", "confirmed"])
    .lte("date", today);
  const appts = rows ?? [];
  if (appts.length === 0) return NextResponse.json({ ok: true, charged: 0, skipped: 0 });

  // Load each shop's settings + Connect info once.
  const shopIds = Array.from(new Set(appts.map(a => a.shop_id)));
  const { data: shops } = await supabaseAdmin
    .from("shops").select("id, name, email, owner_id, booking_settings, stripe_account_id, stripe_connected").in("id", shopIds);
  const shopMap = new Map((shops ?? []).map(s => [s.id, s]));

  const twilio = getTwilio();
  const sender = twilioSender();
  let charged = 0, skipped = 0;

  for (const a of appts) {
    const shop = shopMap.get(a.shop_id);
    const bs = (shop?.booking_settings ?? null) as { no_show_protection?: boolean; no_show_fee_amount?: number } | null;
    const isSaved = a.payment_status === "saved";
    // Held rows need a PaymentIntent to capture; saved rows need a stored card.
    const hasCard = isSaved ? !!a.stripe_payment_method_id : !!a.payment_intent_id;
    if (!shop || !bs?.no_show_protection || !hasCard) { skipped++; continue; }

    const dt = slotToDate(a.date, a.time_slot);
    if (!dt || dt.getTime() + GRACE_MS > now) { skipped++; continue; } // not yet past the grace window

    const feeDollars = bs.no_show_fee_amount ?? 0;
    const totalCents = Math.round((a.total_amount ?? 0) * 100);
    const feeCents = feeDollars > 0
      ? Math.min(Math.round(feeDollars * 100), totalCents)
      : 0;
    const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
    const opts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

    try {
      // Pre-flight lock: atomically claim this row before charging.
      // If another cron run already set it to "capturing"/"captured", this
      // update matches 0 rows and we skip — preventing double-charges.
      // (The WHERE on payment_status makes the claim atomic; .select() returns
      // the updated rows so an empty array means another run won the race.)
      const { data: claimed } = await supabaseAdmin.from("appointments")
        .update({ payment_status: "capturing" })
        .eq("id", a.id)
        .in("payment_status", ["held", "saved"])
        .select("id");
      if (!claimed || claimed.length === 0) { skipped++; continue; }

      let pi: { amount_received?: number | null };
      if (isSaved) {
        // No hold to capture — charge the saved card off-session for the
        // no-show fee (or full price when fee is 0).
        const chargeCents = feeCents > 0 ? feeCents : totalCents;
        if (chargeCents <= 0) { skipped++; continue; }
        pi = await stripe.paymentIntents.create({
          amount: chargeCents,
          currency: "cad",
          customer: a.stripe_customer_id ?? undefined,
          payment_method: a.stripe_payment_method_id!,
          off_session: true,
          confirm: true,
        }, opts);
      } else {
        pi = await stripe.paymentIntents.capture(a.payment_intent_id!, feeCents > 0 ? { amount_to_capture: feeCents } : {}, opts);
      }
      await supabaseAdmin.from("appointments")
        .update({ status: "no-show", payment_status: "captured", payment_method: "card", paid_at: new Date().toISOString() }).eq("id", a.id);
      await supabaseAdmin.from("appointments")
        .update({ no_show_fee_amount: pi.amount_received ?? null }).eq("id", a.id).then(null, () => null);

      // SMS the client (best-effort).
      const to = toE164(a.client_phone);
      if (twilio && sender && to) {
        const amt = ((pi.amount_received ?? 0) / 100).toFixed(2);
        twilio.messages.create({
          ...sender, to,
          body: `Hi ${a.client_name}, you missed your appointment at ${shop.name} on ${prettyDate(a.date)}. A no-show fee of $${amt} has been charged. — ClipWise`,
        }).then(null, () => null);
      }
      // Email the client a receipt for the fee (best-effort).
      sendPaymentReceipt(BASE_URL, {
        clientEmail: a.client_email,
        clientName: a.client_name,
        shopName: shop.name,
        shopEmail: shop.email,
        date: a.date,
        amountCents: pi.amount_received ?? 0,
        context: "No-show fee",
      });
      // In-app/web success alert to owner + assigned barber (pop-up + chime).
      notifyNoShowCharged({
        ownerId: shop.owner_id,
        barberId: a.barber_id,
        clientName: a.client_name,
        amountCents: pi.amount_received ?? 0,
        date: a.date,
      });
      // Record a transaction so the fee shows in Payments / revenue / analytics.
      await supabaseAdmin.from("transactions").insert({
        shop_id: a.shop_id,
        barber_id: a.barber_id || null,
        client_name: a.client_name || null,
        service_name: "No-show fee",
        amount: (pi.amount_received ?? 0) / 100,
        tip: 0,
        payment_method: "card",
        type: "service",
        appointment_id: a.id,
        source: "no_show",
      }).then(null, () => null);
      console.log("[cron/no-show] charged", { appointment_id: a.id, amount: pi.amount_received });
      charged++;
    } catch {
      // Reset to the original pre-claim status so the next cron run can retry.
      // Setting "failed" permanently meant stuck rows were never retried.
      await supabaseAdmin.from("appointments").update({ payment_status: a.payment_status }).eq("id", a.id).then(null, () => null);
      // Alert the owner in-app so an auto-charge failure doesn't go unseen.
      notifyChargeFailed({
        ownerId: shop.owner_id,
        clientName: a.client_name,
        amountCents: feeCents > 0 ? feeCents : totalCents,
        reason: "no_show",
      });
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, charged, skipped });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
