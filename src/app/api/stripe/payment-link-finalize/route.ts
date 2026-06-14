import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { markAppointmentPaid, serviceNameOf } from "@/lib/finalize-appointment-payment";

// Called when a customer returns from paying a post-booking PAYMENT LINK (owner
// sent it from Payments for an existing unpaid appointment). Verifies the
// Checkout session, flips the appointment to paid, and notifies both sides —
// synchronously, so it works even if the webhook doesn't fire. Idempotent.
export async function POST(request: NextRequest) {
  const { session_id, appointment_id } = await request.json() as { session_id?: string; appointment_id?: string };
  if (!session_id || !appointment_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, client_email, date, time_slot, total_amount, payment_status, status, barbers(name), services(name)")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("name, email, owner_id, stripe_account_id, stripe_connected").eq("id", appt.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const barberName = Array.isArray(appt.barbers)
    ? ((appt.barbers[0] as { name?: string })?.name ?? "Any Available")
    : ((appt.barbers as { name?: string } | null)?.name ?? "Any Available");
  const summary = {
    shopName: shop.name,
    barberName,
    serviceName: serviceNameOf(appt.services),
    date: appt.date,
    time: appt.time_slot,
    total: Number(appt.total_amount ?? 0),
    clientEmail: appt.client_email ?? "",
    paymentNote: "Payment received — thank you!",
  };

  // Already settled — return the summary without re-notifying.
  if (appt.payment_status === "paid") {
    return NextResponse.json({ paid: true, appointmentId: appt.id, summary });
  }

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  const acctOpts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;
  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id, undefined, acctOpts);
  } catch {
    // Session retrieval failed (e.g. temporary Stripe error). Check if the
    // webhook already settled this — if so, return success so the customer
    // doesn't see an error screen even though their payment went through.
    const { data: recheck } = await supabaseAdmin
      .from("appointments").select("payment_status").eq("id", appointment_id).maybeSingle();
    if (recheck?.payment_status === "paid") {
      return NextResponse.json({ paid: true, appointmentId: appt.id, summary });
    }
    return NextResponse.json({ paid: false }, { status: 200 });
  }
  if (session.payment_status !== "paid") {
    // Session not paid yet — do one more DB check in case webhook just fired.
    const { data: recheck } = await supabaseAdmin
      .from("appointments").select("payment_status").eq("id", appointment_id).maybeSingle();
    if (recheck?.payment_status === "paid") {
      return NextResponse.json({ paid: true, appointmentId: appt.id, summary });
    }
    return NextResponse.json({ paid: false }, { status: 200 });
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  await markAppointmentPaid({ appt, shop, baseUrl, paymentIntentId });

  return NextResponse.json({ paid: true, appointmentId: appt.id, summary });
}
