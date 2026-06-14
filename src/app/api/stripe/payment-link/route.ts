import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { sendSmsBestEffort } from "@/lib/twilio";

/**
 * Create a Stripe Checkout Session for an *existing, unpaid* appointment
 * and optionally email the customer the link.
 *
 * Used by the shop owner to take payment after the fact: e.g. customer
 * booked with "pay in person", barber finishes the service, owner hits
 * "Complete" → app asks how to take payment → "Send payment link" hits
 * this route. Webhook then flips `payment_status: paid` on the row.
 *
 * Runs on the shop's connected account so the money lands directly in
 * their Stripe balance (0% platform fee, same as initial bookings).
 */
export async function POST(request: NextRequest) {
  const BASE_URL = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { appointment_id, send_email, send_sms, email, phone } = await request.json() as {
    appointment_id: string;
    send_email?: boolean;
    send_sms?: boolean;
    email?: string;   // optional override / fill-in when none on file
    phone?: string;   // optional override / fill-in when none on file
  };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, client_name, client_email, client_phone, date, time_slot, total_amount, payment_status, services(name)")
    .eq("id", appointment_id)
    .single();

  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  if (appt.payment_status === "paid") {
    return NextResponse.json({ error: "Already paid" }, { status: 400 });
  }
  if (!appt.total_amount || appt.total_amount <= 0) {
    return NextResponse.json({ error: "Appointment has no amount to charge" }, { status: 400 });
  }

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("name, slug, stripe_account_id, stripe_connected, subscription_plan, subscription_status, email")
    .eq("id", appt.shop_id)
    .single();

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "payments")) {
    return NextResponse.json({ error: "Online payments require a paid plan." }, { status: 403 });
  }

  // Connect direct-charge when the shop has finished onboarding (money lands
  // in their own Stripe balance, 0% platform fee). Otherwise fall back to a
  // platform charge (money lands in the platform's Stripe account). The
  // platform-charge path is what makes test-mode / demo flows work without
  // the shop owner having to complete the multi-minute Connect KYC.
  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  // Require Stripe Connect — never platform-charge an un-onboarded shop, so the
  // money always lands in the shop's own account. Block until Connect is done.
  if (!useConnect) {
    return NextResponse.json(
      { error: "This shop hasn't finished setting up online payments yet. Please collect payment in person." },
      { status: 409 },
    );
  }

  const serviceName = Array.isArray(appt.services)
    ? (appt.services[0]?.name ?? "Service")
    : ((appt.services as { name?: string } | null)?.name ?? "Service");

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "cad",
            product_data: { name: `${serviceName} — ${shop.name}` },
            unit_amount: Math.round(appt.total_amount * 100),
          },
          quantity: 1,
        }],
        customer_email: appt.client_email ?? undefined,
        // We tag the session so the webhook can look up the appointment
        // without needing the payment_intent_id mapping again.
        metadata: {
          flow: "post_booking_payment",
          appointment_id: appt.id,
          shop_id: appt.shop_id,
        },
        success_url: `${BASE_URL}/book/${shop.slug}?paid_appt=${appt.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${BASE_URL}/book/${shop.slug}?cancelled=1`,
      },
      useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined
    );

    // Store the session's payment_intent_id on the appointment ahead of time
    // so the webhook can match either by metadata or by payment_intent_id.
    if (typeof session.payment_intent === "string") {
      await supabaseAdmin
        .from("appointments")
        .update({ payment_intent_id: session.payment_intent })
        .eq("id", appt.id);
    }

    // Resolve targets: caller can pass an email/phone to use (and we persist
    // them to the appointment so receipts/SMS work next time too), else fall
    // back to whatever is on file.
    const emailTo = (email?.trim() || appt.client_email || "").trim();
    const phoneTo = (phone?.trim() || appt.client_phone || "").trim();

    // Persist any newly-provided contact details on the appointment.
    const patch: Record<string, string> = {};
    if (email?.trim() && email.trim() !== (appt.client_email ?? "")) patch.client_email = email.trim();
    if (phone?.trim() && phone.trim() !== (appt.client_phone ?? "")) patch.client_phone = phone.trim();
    if (Object.keys(patch).length) {
      await supabaseAdmin.from("appointments").update(patch).eq("id", appt.id).then(null, () => null);
    }

    let emailed = false;
    let texted = false;

    // Email the link
    if (send_email && emailTo && session.url) {
      fetch(`${BASE_URL}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "payment_link",
          data: {
            clientName: appt.client_name,
            clientEmail: emailTo,
            shopName: shop.name,
            shopEmail: shop.email ?? "",
            serviceName,
            amount: appt.total_amount,
            paymentUrl: session.url,
            date: appt.date,
            time: appt.time_slot,
          },
        }),
      }).catch(() => null);
      emailed = true;
    }

    // Text the link
    if (send_sms && phoneTo && session.url) {
      await sendSmsBestEffort(
        phoneTo,
        `Pay for your ${serviceName} appointment: ${session.url}`,
        shop.name,
      );
      texted = true;
    }

    return NextResponse.json({ url: session.url, emailed, texted });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
