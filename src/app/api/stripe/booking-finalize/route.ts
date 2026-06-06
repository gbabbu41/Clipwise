import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Called when the customer returns from a paid booking checkout.
// Verifies payment on the connected account, then creates the appointment (idempotent).
export async function POST(request: NextRequest) {
  const { session_id, shop_id } = await request.json() as { session_id: string; shop_id: string };
  if (!session_id || !shop_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id, stripe_connected").eq("id", shop_id).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  try {
    const session = await stripe.checkout.sessions.retrieve(
      session_id,
      undefined,
      useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined,
    );
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

    // Auto-register the customer in the shop's client book, deduped by
    // email → phone so a returning customer never doubles up.
    {
      const email = (m.client_email ?? "").trim();
      const phone = (m.client_phone ?? "").trim();
      let existingClient: { id: string } | null = null;
      if (email) {
        const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", m.shop_id).ilike("email", email).maybeSingle();
        existingClient = data;
      }
      if (!existingClient && phone) {
        const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", m.shop_id).eq("phone", phone).maybeSingle();
        existingClient = data;
      }
      if (!existingClient && m.client_name) {
        await supabaseAdmin.from("clients").insert({
          shop_id: m.shop_id, name: m.client_name, email, phone,
          total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
        }).then(null, () => null);
      }
    }

    // Notify the shop owner (fire-and-forget). Title carries the amount
    // so it's scannable at a glance ('New Paid Booking · $35'). Message
    // formats the raw YYYY-MM-DD date as 'July 6' for readability — we
    // don't use friendlyDate (Today/Tomorrow) here because the server's
    // clock is in UTC and would mis-label dates near the day boundary.
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id, name").eq("id", m.shop_id).single();
    if (shopRow?.owner_id) {
      const amountStr = `$${Number(m.total_amount ?? 0).toFixed(0)}`;
      const dateObj = new Date(`${m.date}T00:00:00`);
      const friendly = dateObj.toLocaleDateString("en-CA", { month: "long", day: "numeric" });
      supabaseAdmin.from("notifications").insert({
        user_id: shopRow.owner_id,
        title: `New Paid Booking · ${amountStr}`,
        message: `${m.client_name} booked & paid for ${friendly} at ${m.time_slot}`,
        type: "booking",
        is_read: false,
      }).then(null, () => null);
    }

    return NextResponse.json({ paid: true, appointmentId: appt.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
