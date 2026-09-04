import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { authorizeAppointment } from "@/lib/api-auth";

/**
 * Return how much is ACTUALLY held (capturable) on an appointment's card, so the
 * checkout UI can show the true amount a "Capture" will charge — not the stored
 * total_amount, which can sit ABOVE the hold when a price was raised after
 * booking (Stripe can't capture more than it authorized). Read-only. Owner or a
 * barber with manage_appointments (same gate as capture-appointment).
 */
export async function POST(request: NextRequest) {
  const { appointment_id } = (await request.json().catch(() => ({}))) as { appointment_id?: string };
  const auth = await authorizeAppointment(request, appointment_id, { permission: "manage_appointments" });
  if ("error" in auth) return auth.error;
  const appt = auth.appointment as { payment_intent_id?: string | null; payment_status?: string | null };
  const shop = auth.shop as { stripe_account_id?: string | null; stripe_connected?: boolean | null };

  // Only a HELD authorization has a capped capturable; a saved card charges fresh
  // and an unpaid/cash booking is collected in person, so there's nothing to cap.
  if (appt.payment_status !== "held" || !appt.payment_intent_id) {
    return NextResponse.json({ ok: true, capturable: null });
  }
  const opts = shop.stripe_account_id && shop.stripe_connected ? { stripeAccount: shop.stripe_account_id } : undefined;
  try {
    const pi = await stripe.paymentIntents.retrieve(appt.payment_intent_id, undefined, opts);
    const capturable = (pi.amount_capturable ?? 0) / 100;
    return NextResponse.json({ ok: true, capturable });
  } catch {
    // Never break the checkout UI over this — the button just falls back to the
    // stored total when we can't read the hold.
    return NextResponse.json({ ok: true, capturable: null });
  }
}
