import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { authorizeAppointment } from "@/lib/api-auth";

/**
 * Expire any open Checkout session from a previously-sent payment link.
 *
 * Called when an appointment is settled another way (e.g. cash) so the customer
 * can't still pay the stale link and get double-charged. Best-effort: if the
 * session is already completed/expired we just no-op (the webhook duplicate
 * guard is the backstop that auto-refunds anything that slips through).
 *
 * Owner or a barber with manage_appointments only — otherwise any logged-in
 * user could expire another shop's payment link and block a customer from paying.
 */
export async function POST(request: NextRequest) {
  const { appointment_id } = await request.json() as { appointment_id?: string };
  const auth = await authorizeAppointment(request, appointment_id, { permission: "manage_appointments" });
  if ("error" in auth) return auth.error;

  const appt = auth.appointment as { stripe_checkout_session_id?: string | null };
  const shop = auth.shop as { stripe_account_id?: string | null };
  if (!appt.stripe_checkout_session_id) return NextResponse.json({ ok: true, expired: false });

  try {
    await stripe.checkout.sessions.expire(
      appt.stripe_checkout_session_id,
      undefined,
      shop.stripe_account_id ? { stripeAccount: shop.stripe_account_id } : undefined,
    );
    return NextResponse.json({ ok: true, expired: true });
  } catch {
    // Already completed / expired / not found — nothing to expire.
    return NextResponse.json({ ok: true, expired: false });
  }
}
