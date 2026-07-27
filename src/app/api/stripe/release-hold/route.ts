import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Release an UNCAPTURED card authorization (a no-show "hold") without charging.
 * Used when the owner rejects/cancels an upcoming held-card booking — a hold
 * can't be refunded (no money moved), only cancelled, or Stripe auto-voids it
 * ~7 days later, leaving the customer's available balance reduced meanwhile.
 * Owner-only; the cancel runs on the shop's connected account. This route only
 * touches the money — the caller handles the appointment status + notifications.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id } = await request.json() as { appointment_id: string };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments").select("id, shop_id, payment_status, payment_intent_id").eq("id", appointment_id).single();
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id, stripe_account_id").eq("id", appt.shop_id).single();
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Only an uncaptured hold can be released. Anything already settled (paid /
  // captured) must go through the refund route instead; nothing to do otherwise.
  if (appt.payment_status !== "held" || !appt.payment_intent_id) {
    return NextResponse.json({ ok: true, released: false });
  }

  const opts = shop.stripe_account_id ? { stripeAccount: shop.stripe_account_id } : undefined;
  try {
    await stripe.paymentIntents.cancel(appt.payment_intent_id, undefined, opts);
  } catch (e) {
    // Already voided/captured elsewhere — benign; treat as released and sync.
    const err = e as { code?: string; raw?: { code?: string } };
    const code = err?.code ?? err?.raw?.code ?? "";
    if (!/already_canceled|payment_intent_unexpected_state|resource_missing/.test(code)) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Release failed" }, { status: 500 });
    }
  }
  await supabaseAdmin.from("appointments").update({ payment_status: "voided" }).eq("id", appointment_id).then(null, () => null);
  return NextResponse.json({ ok: true, released: true });
}
