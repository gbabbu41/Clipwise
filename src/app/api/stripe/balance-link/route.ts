import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { sendSmsBestEffort } from "@/lib/twilio";
import { authorizeAppointment } from "@/lib/api-auth";

/**
 * Send a Stripe Checkout link for the leftover `balance_due` on an appointment
 * (the part a raised price the held card couldn't cover). Unlike the full
 * payment-link, this charges ONLY the balance and never touches total_amount /
 * marks the appointment paid — the webhook (flow "balance") records the balance
 * ledger row + zeroes balance_due when the customer pays.
 *
 * Owner or a barber with manage_appointments.
 */
export async function POST(request: NextRequest) {
  const BASE_URL = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  const { appointment_id, send_email, send_sms, email, phone } = (await request.json().catch(() => ({}))) as {
    appointment_id?: string; send_email?: boolean; send_sms?: boolean; email?: string; phone?: string;
  };
  const auth = await authorizeAppointment(request, appointment_id, { permission: "manage_appointments" });
  if ("error" in auth) return auth.error;
  const appt = auth.appointment as {
    id: string; shop_id: string; barber_id: string | null; service_id: string | null;
    client_name: string | null; client_email: string | null; client_phone: string | null;
    date: string | null; time_slot: string | null;
    total_amount: number | null; tax_amount: number | null; balance_due: number | null;
  };

  const balance = Math.max(0, Math.round(Number(appt.balance_due ?? 0) * 100)) / 100;
  if (balance <= 0) return NextResponse.json({ error: "No balance to collect." }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("name, slug, stripe_account_id, stripe_connected, subscription_plan, subscription_status, email")
    .eq("id", appt.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "payments")) {
    return NextResponse.json({ error: "Online payments require a paid plan." }, { status: 403 });
  }
  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  if (!useConnect) {
    return NextResponse.json({ error: "This shop hasn't finished setting up online payments — take the balance in person." }, { status: 409 });
  }

  const { data: svc } = appt.service_id
    ? await supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
    : { data: null as { name: string } | null };
  const serviceName = svc?.name ?? "Service";

  // Split the balance into pre-tax service + tax by the appointment's own ratio so
  // the ledger row (written by the webhook) matches the rest of the sale.
  const total = Math.max(0, Number(appt.total_amount ?? 0));
  const taxFull = Math.max(0, Number(appt.tax_amount ?? 0));
  const taxRatio = total > 0 ? Math.min(1, taxFull / total) : 0;
  const balTax = Math.round(balance * taxRatio * 100) / 100;
  const balService = Math.max(0, Math.round((balance - balTax) * 100) / 100);

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          { price_data: { currency: "cad", product_data: { name: `${serviceName} (balance) — ${shop.name}` }, unit_amount: Math.round(balService * 100) }, quantity: 1 },
          ...(balTax > 0 ? [{ price_data: { currency: "cad" as const, product_data: { name: "Tax" }, unit_amount: Math.round(balTax * 100) }, quantity: 1 }] : []),
        ],
        customer_email: appt.client_email ?? undefined,
        metadata: {
          flow: "balance",
          appointment_id: appt.id,
          shop_id: appt.shop_id,
          barber_id: appt.barber_id ?? "",
          bal_service: String(balService),
          bal_tax: String(balTax),
        },
        success_url: `${BASE_URL}/book/${shop.slug}?balance_paid=${appt.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/book/${shop.slug}?cancelled=1`,
      },
      { stripeAccount: shop.stripe_account_id! },
    );

    const emailTo = (email?.trim() || appt.client_email || "").trim();
    const phoneTo = (phone?.trim() || appt.client_phone || "").trim();
    let emailed = false, texted = false;

    if (send_email && emailTo && session.url) {
      const er = await fetch(`${BASE_URL}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CRON_SECRET ?? "", Authorization: request.headers.get("Authorization") ?? "" },
        body: JSON.stringify({
          type: "payment_link",
          data: {
            clientName: appt.client_name, clientEmail: emailTo, shopName: shop.name, shopEmail: shop.email ?? "",
            serviceName: `${serviceName} (balance)`,
            amount: balance, subtotal: balService, tax: balTax, taxLabel: "Tax",
            paymentUrl: session.url, date: appt.date, time: appt.time_slot,
          },
        }),
      }).catch(() => null);
      emailed = !!er && er.ok;
    }
    if (send_sms && phoneTo && session.url) {
      await sendSmsBestEffort(phoneTo, `Pay the remaining balance for your ${serviceName} appointment: ${session.url}`, shop.name);
      texted = true;
    }

    return NextResponse.json({ url: session.url, emailed, texted });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
