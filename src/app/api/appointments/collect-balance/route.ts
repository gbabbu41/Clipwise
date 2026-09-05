import { NextRequest, NextResponse } from "next/server";
import { stripe, stripeFeeCents, STRIPE_LIVE_MODE } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeAppointment } from "@/lib/api-auth";

/**
 * Collect the leftover `balance_due` on an appointment — the part of a raised
 * price the held card couldn't cover.
 *   method "cash" — record the balance as taken in person.
 *   method "card" — charge it off-session on the card saved for this booking.
 *
 * Writes ONE ledger row (source "balance", split into pre-tax service + tax the
 * same way as the sale) and zeroes balance_due so it leaves Checkout → Unpaid and
 * the appointment counts its full total again. Revenue adds the balance's net via
 * a dedicated loop in collectedTotals, so nothing double-counts.
 *
 * Owner or a barber with manage_appointments (same gate as capture-appointment).
 */
export async function POST(request: NextRequest) {
  const { appointment_id, method } = (await request.json().catch(() => ({}))) as {
    appointment_id?: string; method?: "cash" | "card";
  };
  const auth = await authorizeAppointment(request, appointment_id, { permission: "manage_appointments" });
  if ("error" in auth) return auth.error;
  const appt = auth.appointment as {
    id: string; shop_id: string; barber_id: string | null; service_id: string | null;
    client_name: string | null; total_amount: number | null; tax_amount: number | null;
    balance_due: number | null; stripe_customer_id: string | null; stripe_payment_method_id: string | null;
  };
  const shop = auth.shop as { stripe_account_id?: string | null; stripe_connected?: boolean | null };

  const balance = Math.max(0, Math.round(Number(appt.balance_due ?? 0) * 100)) / 100;
  if (balance <= 0) return NextResponse.json({ ok: true, nothing: true });

  // Split the balance into pre-tax service + tax by the appointment's own ratio,
  // so the ledger row matches how the rest of the sale was recorded.
  const total = Math.max(0, Number(appt.total_amount ?? 0));
  const taxFull = Math.max(0, Number(appt.tax_amount ?? 0));
  const taxRatio = total > 0 ? Math.min(1, taxFull / total) : 0;
  const balTax = Math.round(balance * taxRatio * 100) / 100;
  const balService = Math.max(0, Math.round((balance - balTax) * 100) / 100);

  const { data: svc } = appt.service_id
    ? await supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
    : { data: null as { name: string } | null };
  const serviceName = `${svc?.name ?? "Service"} (balance)`;

  let paymentMethod: "cash" | "card" = "cash";
  let stripeFee = 0;
  let piId: string | null = null;

  if (method === "card") {
    if (!appt.stripe_payment_method_id) {
      return NextResponse.json({ ok: false, error: "No card on file for this booking — take cash or send a payment link." }, { status: 400 });
    }
    const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
    if (!useConnect && STRIPE_LIVE_MODE) {
      return NextResponse.json({ ok: false, error: "This shop must finish Stripe setup before charges can run." }, { status: 400 });
    }
    const opts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;
    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(balance * 100),
        currency: "cad",
        customer: appt.stripe_customer_id ?? undefined,
        payment_method: appt.stripe_payment_method_id,
        off_session: true,
        confirm: true,
      }, {
        ...(opts ?? {}),
        // Collapse a double-tap into one charge (create() would otherwise charge twice).
        idempotencyKey: `balance-${appt.id}-${Math.round(balance * 100)}`,
      });
      piId = pi.id ?? null;
      stripeFee = (await stripeFeeCents(pi.id, useConnect ? shop.stripe_account_id : null)) / 100;
      paymentMethod = "card";
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Card charge failed" }, { status: 500 });
    }
  }

  // Ledger the balance. source "balance" → collectedTotals adds its net (and the
  // appointment counts its full total once balance_due is 0), never double-counted
  // as a standalone POS sale. Drop lagging columns (stripe_fee/tax) and retry so
  // a pre-migration prod can't fail the collection.
  const row: Record<string, unknown> = {
    shop_id: appt.shop_id,
    barber_id: appt.barber_id || null,
    client_name: appt.client_name || null,
    service_name: serviceName,
    amount: balService, tip: 0, tax: balTax,
    payment_method: paymentMethod, type: "service",
    appointment_id: appt.id,
    payment_intent_id: piId,
    source: "balance",
    stripe_fee: stripeFee,
  };
  const res = await supabaseAdmin.from("transactions").insert(row);
  if (res.error && /column|does not exist|schema cache/i.test(res.error.message)) {
    const { stripe_fee: _f, tax: _t, ...base } = row;
    void _f; void _t;
    await supabaseAdmin.from("transactions").insert({ ...base, amount: balService + balTax }).then(null, () => null);
  }

  await supabaseAdmin.from("appointments").update({ balance_due: 0 }).eq("id", appt.id).then(null, () => null);

  return NextResponse.json({ ok: true, amount: balance, method: paymentMethod });
}
