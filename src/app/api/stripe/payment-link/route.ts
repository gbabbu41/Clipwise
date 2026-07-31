import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { sendSmsBestEffort } from "@/lib/twilio";
import { authorizeAppointment } from "@/lib/api-auth";
import { taxOnAmount, taxLabelDetailed, type TaxConfig } from "@/lib/pricing";

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
  const { appointment_id, send_email, send_sms, email, phone, complete_on_paid } = await request.json() as {
    appointment_id: string;
    send_email?: boolean;
    send_sms?: boolean;
    email?: string;   // optional override / fill-in when none on file
    phone?: string;   // optional override / fill-in when none on file
    complete_on_paid?: boolean; // checkout flow → mark the appointment completed when paid
  };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  // Owner or a barber with manage_appointments only. Without this, anyone with a
  // (leaked) appointment id could overwrite its contact details and blast
  // "Pay Now" messages to arbitrary addresses via the shop's email/SMS.
  const auth = await authorizeAppointment(request, appointment_id, { permission: "manage_appointments" });
  if ("error" in auth) return auth.error;

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, client_name, client_email, client_phone, date, time_slot, total_amount, tax_amount, payment_status, services(name)")
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
    .select("name, slug, stripe_account_id, stripe_connected, subscription_plan, subscription_status, email, booking_settings")
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

  // ── Sales tax (one truth) ───────────────────────────────────────────────────
  // Charge service + tax when the shop is registered (valid GST/HST number). Tax
  // is computed on the PRE-TAX base — total_amount minus any tax already applied —
  // so re-sending the link never double-taxes (idempotent). When the shop isn't
  // charging tax, taxDollars is 0 and a plain no-tax booking is left untouched.
  const bs = shop.booking_settings as TaxConfig | null;
  const existingTax = Math.max(0, Number(appt.tax_amount ?? 0));
  const preTaxDollars = Math.max(0, Number(appt.total_amount ?? 0) - existingTax);
  const taxDollars = taxOnAmount(preTaxDollars, bs);
  const grossDollars = Math.round((preTaxDollars + taxDollars) * 100) / 100;
  // Receipt-style label with the rate baked in ("HST (13%)", or "GST (5%) + PST
  // (7%)" for multi-tax provinces) — shown on both the Stripe page and the email
  // breakdown so the customer sees exactly what the tax is.
  const taxLabel = taxLabelDetailed(bs);

  // Persist the authoritative amounts so the ledger + receipt (webhook / finalize)
  // read ONE stored truth (total_amount = gross, tax_amount = the tax portion).
  // Only write when tax is actually involved — never touch a no-tax booking.
  if (taxDollars > 0 || existingTax > 0) {
    const upd = await supabaseAdmin.from("appointments")
      .update({ total_amount: grossDollars, tax_amount: taxDollars })
      .eq("id", appt.id);
    if (upd.error && /tax_amount/.test(upd.error.message)) {
      await supabaseAdmin.from("appointments").update({ total_amount: grossDollars }).eq("id", appt.id).then(null, () => null);
    }
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "cad",
              product_data: { name: `${serviceName} — ${shop.name}` },
              unit_amount: Math.round(preTaxDollars * 100),
            },
            quantity: 1,
          },
          // Separate tax line so the customer sees it on the Stripe page. Sum of
          // the two = grossDollars = what the webhook/ledger record.
          ...(taxDollars > 0 ? [{
            price_data: {
              currency: "cad" as const,
              product_data: { name: taxLabel },
              unit_amount: Math.round(taxDollars * 100),
            },
            quantity: 1,
          }] : []),
        ],
        customer_email: appt.client_email ?? undefined,
        // We tag the session so the webhook can look up the appointment
        // without needing the payment_intent_id mapping again.
        metadata: {
          flow: "post_booking_payment",
          appointment_id: appt.id,
          shop_id: appt.shop_id,
          // Checkout flow: once this link is paid, flip the appointment to
          // "completed" (not just paid). Booking-time prepay omits this so it
          // stays "confirmed" until the barber checks out in person.
          ...(complete_on_paid ? { complete_on_paid: "1" } : {}),
        },
        success_url: `${BASE_URL}/book/${shop.slug}?paid_appt=${appt.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${BASE_URL}/book/${shop.slug}?cancelled=1`,
      },
      useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined
    );

    // Store the checkout session id (+ payment_intent if present) so the payment
    // can be reconciled later even if the customer never lands back on the
    // success page and the webhook doesn't fire (see /api/stripe/reconcile-payments).
    await supabaseAdmin
      .from("appointments")
      .update({
        stripe_checkout_session_id: session.id,
        ...(typeof session.payment_intent === "string" ? { payment_intent_id: session.payment_intent } : {}),
      })
      .eq("id", appt.id)
      .then(null, () => null);

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

    // Email the link. IMPORTANT: await it — a fire-and-forget fetch gets killed
    // when the serverless function returns, so the email silently never sends.
    if (send_email && emailTo && session.url) {
      const er = await fetch(`${BASE_URL}/api/send-email`, {
        method: "POST",
        // Forward the caller's bearer token too so this gated send authenticates
        // even when CRON_SECRET is unset in prod (see invite/route.ts). The
        // caller was already authorized on this appointment above.
        headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CRON_SECRET ?? "", Authorization: request.headers.get("Authorization") ?? "" },
        body: JSON.stringify({
          type: "payment_link",
          data: {
            clientName: appt.client_name,
            clientEmail: emailTo,
            shopName: shop.name,
            shopEmail: shop.email ?? "",
            serviceName,
            // Itemised breakdown so the receipt email shows price + tax, not just
            // a lump sum. subtotal + tax = amount (the gross total charged).
            amount: grossDollars,
            subtotal: preTaxDollars,
            tax: taxDollars,
            taxLabel,
            paymentUrl: session.url,
            date: appt.date,
            time: appt.time_slot,
          },
        }),
      }).catch(() => null);
      emailed = !!er && er.ok;
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
