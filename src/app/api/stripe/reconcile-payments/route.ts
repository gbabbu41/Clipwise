import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { markAppointmentPaid } from "@/lib/finalize-appointment-payment";

// Owner-side catch-up for payment-link payments: checks unpaid appointments that
// have a Stripe Checkout session against Stripe and flips any that were actually
// paid to "paid" (firing the receipt + owner alerts). Called when the owner
// opens Payments/Appointments, so status stays correct even when the customer
// never returns to the success page and the webhook didn't fire.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Resolve the caller's shop (owner) — or, for a barber, the shop they belong to.
  const { data: ownerShops } = await supabaseAdmin
    .from("shops").select("id, name, email, owner_id, stripe_account_id, stripe_connected")
    .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
  let shop = ownerShops?.[0] ?? null;
  if (!shop) {
    const { data: barber } = await supabaseAdmin
      .from("barbers").select("shop_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (barber?.shop_id) {
      const { data: bShop } = await supabaseAdmin
        .from("shops").select("id, name, email, owner_id, stripe_account_id, stripe_connected")
        .eq("id", barber.shop_id).maybeSingle();
      shop = bShop ?? null;
    }
  }
  if (!shop) return NextResponse.json({ ok: true, updated: 0 });

  const acctOpts = (shop.stripe_account_id && shop.stripe_connected)
    ? { stripeAccount: shop.stripe_account_id } : undefined;

  // Only recent, still-relevant, unpaid appointments that carry a checkout session.
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const { data: appts } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, client_email, date, time_slot, total_amount, payment_status, status, stripe_checkout_session_id, services(name)")
    .eq("shop_id", shop.id)
    .not("stripe_checkout_session_id", "is", null)
    .neq("payment_status", "paid")
    .in("status", ["pending", "confirmed", "completed"])
    .gte("date", cutoff)
    .limit(25);

  if (!appts || appts.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  let updated = 0;
  for (const appt of appts) {
    const sessionId = (appt as { stripe_checkout_session_id?: string }).stripe_checkout_session_id;
    if (!sessionId) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, undefined, acctOpts);
      if (session.payment_status === "paid") {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : null;
        const completeOnPaid = session.metadata?.complete_on_paid === "1";
        const flipped = await markAppointmentPaid({ appt, shop, baseUrl, paymentIntentId: pi, completeOnPaid });
        if (flipped) updated++;
      }
    } catch { /* skip unresolvable sessions */ }
  }

  return NextResponse.json({ ok: true, updated });
}
