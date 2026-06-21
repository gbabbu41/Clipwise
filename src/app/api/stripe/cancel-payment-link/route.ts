import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Expire any open Checkout session from a previously-sent payment link.
 *
 * Called when an appointment is settled another way (e.g. cash) so the customer
 * can't still pay the stale link and get double-charged. Best-effort: if the
 * session is already completed/expired we just no-op (the webhook duplicate
 * guard is the backstop that auto-refunds anything that slips through).
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id } = await request.json() as { appointment_id?: string };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments").select("shop_id, stripe_checkout_session_id").eq("id", appointment_id).maybeSingle();
  if (!appt?.stripe_checkout_session_id) return NextResponse.json({ ok: true, expired: false });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id").eq("id", appt.shop_id).maybeSingle();

  try {
    await stripe.checkout.sessions.expire(
      appt.stripe_checkout_session_id,
      undefined,
      shop?.stripe_account_id ? { stripeAccount: shop.stripe_account_id } : undefined,
    );
    return NextResponse.json({ ok: true, expired: true });
  } catch {
    // Already completed / expired / not found — nothing to expire.
    return NextResponse.json({ ok: true, expired: false });
  }
}
