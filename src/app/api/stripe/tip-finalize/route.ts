import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordTipFromCheckout } from "@/lib/finalize-tip";

// Called when the customer returns from a paid tip checkout (/tip/[id]?paid=1).
// The safety net for the connected-account webhook: verifies the tip settled and
// records it into our DB so the barber + owner actually see it — even if the
// webhook never arrives. Idempotent (PaymentIntent dedup in recordTipFromCheckout),
// so it's a clean no-op when the webhook already handled it.
export async function POST(request: NextRequest) {
  const { session_id, appointment_id } = await request.json() as { session_id?: string; appointment_id?: string };
  if (!session_id || !appointment_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  // Resolve the appointment → its shop's connected account (the charge ran there).
  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, shops(stripe_account_id, stripe_connected)")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const shop = (Array.isArray(appt.shops) ? appt.shops[0] : appt.shops) as
    { stripe_account_id: string | null; stripe_connected: boolean | null } | null;
  const useConnect = !!(shop?.stripe_account_id && shop?.stripe_connected);

  try {
    const session = await stripe.checkout.sessions.retrieve(
      session_id, undefined, useConnect ? { stripeAccount: shop!.stripe_account_id! } : undefined,
    );
    if (session.payment_status !== "paid") return NextResponse.json({ paid: false });

    const m = session.metadata ?? {};
    // Verify the session is genuinely THIS booking's tip — never trust the client's
    // appointment_id alone; the money's own metadata must agree.
    if (m.flow !== "tip" || m.appointment_id !== appt.id) {
      return NextResponse.json({ error: "Session mismatch" }, { status: 400 });
    }

    const tipPi = typeof session.payment_intent === "string" ? session.payment_intent : null;
    await recordTipFromCheckout({
      appointmentId: appt.id,
      shopId: appt.shop_id,
      barberId: appt.barber_id ?? null,
      clientName: appt.client_name ?? null,
      tipDollars: Number(m.tip_amount ?? 0),
      paymentIntentId: tipPi,
    });

    return NextResponse.json({ paid: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
