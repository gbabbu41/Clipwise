import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Called when the customer returns from a paid booking checkout.
// Verifies payment on the connected account, then creates the appointment (idempotent).
export async function POST(request: NextRequest) {
  const { session_id, shop_id } = await request.json() as { session_id: string; shop_id: string };
  if (!session_id || !shop_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id").eq("id", shop_id).single();
  if (!shop?.stripe_account_id) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, undefined, { stripeAccount: shop.stripe_account_id });
    if (session.payment_status !== "paid") {
      return NextResponse.json({ paid: false }, { status: 200 });
    }

    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
    const m = session.metadata ?? {};

    // Idempotency — don't double-create if this payment already produced an appointment
    if (paymentIntentId) {
      const { data: existing } = await supabaseAdmin
        .from("appointments").select("id").eq("payment_intent_id", paymentIntentId).maybeSingle();
      if (existing) return NextResponse.json({ paid: true, appointmentId: existing.id });
    }

    const { data: appt, error } = await supabaseAdmin.from("appointments").insert({
      shop_id: m.shop_id,
      barber_id: m.barber_id || null,
      service_id: m.service_id,
      client_name: m.client_name,
      client_email: m.client_email,
      client_phone: m.client_phone,
      date: m.date,
      time_slot: m.time_slot,
      status: "confirmed",
      total_amount: Number(m.total_amount ?? 0),
      deposit_paid: true,
      payment_status: "paid",
      payment_intent_id: paymentIntentId,
    }).select("id").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Notify the shop owner (fire-and-forget)
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id, name").eq("id", m.shop_id).single();
    if (shopRow?.owner_id) {
      supabaseAdmin.from("notifications").insert({
        user_id: shopRow.owner_id,
        title: "New Paid Booking",
        message: `${m.client_name} booked & paid a deposit for ${m.date} at ${m.time_slot}`,
        type: "booking",
        is_read: false,
      }).then(null, () => null);
    }

    return NextResponse.json({ paid: true, appointmentId: appt.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
