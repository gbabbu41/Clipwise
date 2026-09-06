import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyRefundIssued } from "@/lib/payment-notify";
import { recordRefundLedger } from "@/lib/refund-ledger";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://clipwise.ca";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id } = await request.json() as { appointment_id: string };

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("*, services(name)")
    .eq("id", appointment_id)
    .single();
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  // Verify the caller owns the shop
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, email, slug, owner_id, stripe_account_id").eq("id", appt.shop_id).single();
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // No self-imposed time limit (was a 30-day block measured from the appointment
  // DATE — inconsistent with the other refund route, which had none, and stricter
  // than Stripe's own ~180-day window). Stripe enforces its real limit and returns
  // an error we surface; that's the one source of truth for "too old to refund".
  if (appt.payment_status === "refunded") return NextResponse.json({ error: "This appointment was already refunded." }, { status: 400 });

  // Report the amount actually refunded (a no-show fee refund returns only the
  // fee, not the full booked total).
  let refundedCents = Math.round((appt.total_amount ?? 0) * 100);
  try {
    // Real Stripe refund when there's a captured payment on the connected account
    if (appt.payment_intent_id && shop.stripe_account_id) {
      try {
        const refund = await stripe.refunds.create(
          { payment_intent: appt.payment_intent_id },
          // Idempotency: two concurrent refund taps both pass the status guard, so
          // key the call by the intent — Stripe collapses the retry into one refund.
          { stripeAccount: shop.stripe_account_id, idempotencyKey: `refund-appt-${appt.payment_intent_id}` }
        );
        if (typeof refund.amount === "number") refundedCents = refund.amount;
      } catch (e) {
        // If Stripe says this charge is ALREADY refunded (e.g. an earlier attempt
        // succeeded on Stripe but our record drifted back to "paid"), that's a
        // success from the customer's side — sync our record instead of erroring.
        // Any other Stripe error is a real failure and must surface.
        const err = e as { code?: string; raw?: { code?: string }; message?: string };
        const code = err?.code ?? err?.raw?.code ?? "";
        const alreadyRefunded = code === "charge_already_refunded"
          || /already been refunded|already refunded/i.test(err?.message ?? "");
        if (!alreadyRefunded) throw e;
      }
    }
    // (If no payment_intent — e.g. cash booking — we still mark it refunded for records)

    // Free the chair only when the service HASN'T happened yet. An upcoming
    // (pending/confirmed) booking is cancelled so its slot re-opens; a completed
    // or no-show booking keeps its record (service rendered / slot already used) —
    // we just flag the money refunded.
    const served = appt.status === "completed" || appt.status === "no-show";
    await supabaseAdmin.from("appointments")
      .update(served ? { payment_status: "refunded" } : { status: "cancelled", payment_status: "refunded" })
      .eq("id", appointment_id);

    // Also flag the completion/no-show ledger row so barber earnings + analytics
    // stop counting this revenue/commission immediately — don't wait on the
    // charge.refunded webhook (which may be missed or not registered as a
    // Connect event). Best-effort; the webhook still syncs as a backstop.
    if (appt.payment_intent_id) {
      const { error: txErr } = await supabaseAdmin.from("transactions")
        .update({ refunded: true }).eq("payment_intent_id", appt.payment_intent_id).neq("source", "refund");
      if (txErr) console.warn("[refund] failed to flag transaction refunded:", txErr.message);
    }

    // Dated refund record for the audit trail + GST/HST claim-back (M6). Split the
    // refunded amount into service / tax / tip by the appointment's own ratio.
    {
      const chargeCents = Math.round((appt.total_amount ?? 0) * 100) + Math.round((appt.tip_amount ?? 0) * 100);
      const taxPart = chargeCents > 0 ? Math.round(refundedCents * (Math.round((appt.tax_amount ?? 0) * 100) / chargeCents)) : 0;
      const tipPart = chargeCents > 0 ? Math.round(refundedCents * (Math.round((appt.tip_amount ?? 0) * 100) / chargeCents)) : 0;
      await recordRefundLedger({
        shopId: appt.shop_id, barberId: appt.barber_id, clientName: appt.client_name,
        serviceName: (appt.services as { name: string } | null)?.name ?? null,
        refundedCents, taxCents: taxPart, tipCents: tipPart,
        appointmentId: appt.id, paymentIntentId: appt.payment_intent_id,
      });
    }

    // In-app alert to owner + barber (realtime pop-up + chime).
    notifyRefundIssued({
      ownerId: shop.owner_id,
      barberId: appt.barber_id,
      shopId: appt.shop_id,
      clientName: appt.client_name,
      amountCents: refundedCents,
      date: appt.date,
    });

    // Email the customer
    if (appt.client_email) {
      fetch(`${BASE_URL}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "refund_issued",
          data: {
            clientName: appt.client_name,
            clientEmail: appt.client_email,
            shopName: shop.name,
            shopEmail: shop.email ?? "",
            shopSlug: shop.slug,
            serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
            date: appt.date,
            total: `$${(refundedCents / 100).toFixed(2)}`,
          },
        }),
      }).catch(() => null);
    }

    // Smart waitlist: only when we actually freed the slot (cancelled an upcoming
    // booking) — a completed/no-show refund frees nothing, so don't ping.
    if (!served) {
      fetch(`${BASE_URL}/api/waitlist/slot-opened`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id }),
      }).catch(() => null);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Refund failed" }, { status: 500 });
  }
}
