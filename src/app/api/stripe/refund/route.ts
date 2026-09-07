import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyRefundIssued } from "@/lib/payment-notify";
import { recordRefundLedger } from "@/lib/refund-ledger";
import { refundOrReleaseHold } from "@/lib/stripe-refund";

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
  // A card that was only HELD (no-show protection, never captured) can't be
  // refunded — there's no settled charge — so we release the hold instead. Track
  // it so we skip the $-refund side effects (ledger row, "you were refunded"
  // email) that don't apply when nothing was actually charged.
  let releasedHold = false;
  try {
    // Real Stripe refund when there's a captured payment on the connected account;
    // idempotency-keyed by the intent so concurrent refund taps collapse into one.
    if (appt.payment_intent_id && shop.stripe_account_id) {
      const r = await refundOrReleaseHold(appt.payment_intent_id, shop.stripe_account_id, `refund-appt-${appt.payment_intent_id}`);
      releasedHold = r.released;
      if (r.released) refundedCents = 0;
      else if (r.refundedCents != null) refundedCents = r.refundedCents;
      // r.alreadyRefunded → keep the total_amount fallback (already handled above).
    }
    // (If no payment_intent — e.g. cash booking — we still mark it refunded for records)

    // Free the chair only when the service HASN'T happened yet. An upcoming
    // (pending/confirmed) booking is cancelled so its slot re-opens; a completed
    // or no-show booking keeps its record (service rendered / slot already used) —
    // we just flag the money refunded (or voided, for a released hold).
    const served = appt.status === "completed" || appt.status === "no-show";
    const moneyStatus = releasedHold ? "voided" : "refunded";
    await supabaseAdmin.from("appointments")
      .update(served ? { payment_status: moneyStatus } : { status: "cancelled", payment_status: moneyStatus })
      .eq("id", appointment_id);

    // Money-side effects only apply when money actually moved. A released hold
    // ($0 moved, nothing was ever charged) skips the revenue flag, the refund
    // ledger, the owner alert, and the "you were refunded" email — but still
    // frees the slot + pings the waitlist below.
    if (!releasedHold) {
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

    return NextResponse.json({ ok: true, released: releasedHold });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Refund failed" }, { status: 500 });
  }
}
