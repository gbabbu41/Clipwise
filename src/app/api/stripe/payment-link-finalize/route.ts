import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReceipt, notifyNoShowCharged } from "@/lib/payment-notify";

// Called when a customer returns from paying a post-booking PAYMENT LINK (owner
// sent it from Payments for an existing unpaid appointment). Verifies the
// Checkout session, flips the appointment to paid, and notifies both sides —
// synchronously, so it works even if the webhook doesn't fire. Idempotent.
export async function POST(request: NextRequest) {
  const { session_id, appointment_id } = await request.json() as { session_id?: string; appointment_id?: string };
  if (!session_id || !appointment_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, client_email, date, time_slot, total_amount, payment_status, barbers(name), services(name)")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("name, email, owner_id, stripe_account_id, stripe_connected").eq("id", appt.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const pickName = (rel: unknown): string =>
    Array.isArray(rel) ? ((rel[0] as { name?: string })?.name ?? "") : ((rel as { name?: string } | null)?.name ?? "");
  const serviceName = pickName(appt.services) || "Service";
  const summary = {
    shopName: shop.name,
    barberName: pickName(appt.barbers) || "Any Available",
    serviceName,
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
    return NextResponse.json({ paid: false }, { status: 200 });
  }
  if (session.payment_status !== "paid") return NextResponse.json({ paid: false }, { status: 200 });

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;

  // Conditional flip — only the run that actually transitions unpaid→paid sends
  // the notifications (so we don't double-notify against the webhook).
  const { data: claimed } = await supabaseAdmin
    .from("appointments")
    .update({ payment_status: "paid", payment_method: "online", ...(paymentIntentId ? { payment_intent_id: paymentIntentId } : {}) })
    .eq("id", appt.id)
    .neq("payment_status", "paid")
    .select("id");

  if ((claimed?.length ?? 0) > 0) {
    const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const amountCents = Math.round(Number(appt.total_amount ?? 0) * 100);

    // Customer receipt
    sendPaymentReceipt(baseUrl, {
      clientEmail: appt.client_email,
      clientName: appt.client_name,
      shopName: shop.name,
      shopEmail: shop.email,
      serviceName,
      date: appt.date,
      amountCents,
      context: "Payment received",
    });

    // Owner + barber in-app pop-up ("✅ Payment collected")
    notifyNoShowCharged({
      ownerId: shop.owner_id,
      barberId: appt.barber_id,
      clientName: appt.client_name,
      amountCents,
      date: appt.date,
      kind: "completed",
    });

    // Owner email
    if (shop.email) {
      fetch(`${baseUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "owner_payment_received",
          data: {
            ownerEmail: shop.email,
            clientName: appt.client_name ?? "A client",
            serviceName,
            amount: `$${(amountCents / 100).toFixed(2)}`,
            date: appt.date,
            time: appt.time_slot,
          },
        }),
      }).catch(() => null);
    }
  }

  return NextResponse.json({ paid: true, appointmentId: appt.id, summary });
}
