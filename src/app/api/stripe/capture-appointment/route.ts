import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Capture a previously-authorized (held) PaymentIntent for an appointment.
 *  - reason "completed": capture the full held amount when the service is done.
 *  - reason "no_show":  capture a no-show fee (amount_cents) or the full hold.
 *
 * Reuses the existing Connect setup ({ stripeAccount }) with platform fallback.
 * Never throws to the UI; on failure the appointment is flagged
 * payment_status = "failed" for manual review.
 */
export async function POST(request: NextRequest) {
  const { appointment_id, reason, amount_cents } = await request.json() as {
    appointment_id?: string;
    reason?: "completed" | "no_show";
    amount_cents?: number;
  };
  if (!appointment_id) {
    return NextResponse.json({ ok: false, error: "Missing appointment_id" }, { status: 400 });
  }

  // ── Auth: caller must be the shop owner ───────────────────────────────────
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data: userData } = await supabaseAdmin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, total_amount, payment_intent_id, payment_status")
    .eq("id", appointment_id).single();
  if (!appt) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id, stripe_account_id, stripe_connected").eq("id", appt.shop_id).single();
  if (!shop) return NextResponse.json({ ok: false, error: "Shop not found" }, { status: 404 });
  if (shop.owner_id !== userId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  if (!appt.payment_intent_id) {
    return NextResponse.json({ ok: false, error: "No card is on hold for this appointment." }, { status: 400 });
  }
  if (appt.payment_status === "captured" || appt.payment_status === "paid") {
    return NextResponse.json({ ok: true, alreadyCaptured: true });
  }

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  const opts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;
  const captureParams = (amount_cents && amount_cents > 0) ? { amount_to_capture: amount_cents } : {};

  try {
    const pi = await stripe.paymentIntents.capture(appt.payment_intent_id, captureParams, opts);
    await supabaseAdmin.from("appointments")
      .update({ payment_status: "captured", payment_method: "card" })
      .eq("id", appointment_id);
    // Best-effort — column may not exist until the Phase 1 migration is run.
    if (reason === "no_show") {
      await supabaseAdmin.from("appointments")
        .update({ no_show_fee_amount: pi.amount_received ?? amount_cents ?? null })
        .eq("id", appointment_id).then(null, () => null);
    }
    return NextResponse.json({ ok: true, amount: (pi.amount_received ?? 0) / 100 });
  } catch (err) {
    // Flag for manual review instead of crashing the UI.
    await supabaseAdmin.from("appointments")
      .update({ payment_status: "failed" }).eq("id", appointment_id).then(null, () => null);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Capture failed" }, { status: 500 });
  }
}
