import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Re-check an appointment's payment status against Stripe and sync the row.
 * Belt-and-suspenders for when the webhook didn't fire (e.g. Connect webhook
 * not configured, or a missed delivery) — the owner can manually pull the
 * real state of a sent payment link / charge.
 *
 * Owner-auth'd. Reads the PaymentIntent on the connected account and maps:
 *   succeeded        → paid
 *   requires_capture → held   (authorized, not yet captured)
 *   canceled         → failed
 * Held/saved rows with no PaymentIntent yet are left untouched.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data: userData } = await supabaseAdmin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { appointment_id } = await request.json() as { appointment_id?: string };
  if (!appointment_id) return NextResponse.json({ ok: false, error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments").select("id, shop_id, payment_intent_id, payment_status").eq("id", appointment_id).single();
  if (!appt) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id, stripe_account_id, stripe_connected").eq("id", appt.shop_id).single();
  if (!shop) return NextResponse.json({ ok: false, error: "Shop not found" }, { status: 404 });
  if (shop.owner_id !== userId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  if (!appt.payment_intent_id) {
    return NextResponse.json({ ok: true, payment_status: appt.payment_status, changed: false });
  }

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  const opts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

  try {
    const pi = await stripe.paymentIntents.retrieve(appt.payment_intent_id, undefined, opts);
    let next = appt.payment_status as string | undefined;
    if (pi.status === "succeeded") next = "paid";
    else if (pi.status === "requires_capture") next = "held";
    else if (pi.status === "canceled") next = "failed";

    const changed = next !== appt.payment_status;
    if (changed) {
      await supabaseAdmin.from("appointments")
        .update({ payment_status: next, ...(next === "paid" ? { payment_method: "card", paid_at: new Date().toISOString() } : {}) })
        .eq("id", appointment_id);
    }
    return NextResponse.json({ ok: true, payment_status: next, stripe_status: pi.status, changed });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
