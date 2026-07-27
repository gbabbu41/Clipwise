import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyRefundIssued } from "@/lib/payment-notify";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Stripe throws when a charge was already refunded (e.g. an earlier attempt
// went through but our record drifted). Treat that as success and sync.
function isAlreadyRefunded(err: unknown): boolean {
  const e = err as { code?: string; raw?: { code?: string }; message?: string };
  const code = e?.code ?? e?.raw?.code ?? "";
  return code === "charge_already_refunded" || /already been refunded|already refunded/i.test(e?.message ?? "");
}

/**
 * Refund a *settled* card payment from the Payments page WITHOUT cancelling the
 * appointment (the service was still rendered). Handles both an appointment
 * payment and a POS/standalone transaction. Owner-only. The refund runs on the
 * shop's connected account; the row is flagged refunded and the customer emailed.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id, transaction_id } = await request.json() as {
    appointment_id?: string;
    transaction_id?: string;
  };
  if (!appointment_id && !transaction_id) {
    return NextResponse.json({ error: "Missing appointment_id or transaction_id" }, { status: 400 });
  }

  // ── Appointment refund ──────────────────────────────────────────────────────
  if (appointment_id) {
    const { data: appt } = await supabaseAdmin
      .from("appointments").select("*, services(name)").eq("id", appointment_id).single();
    if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

    const { data: shop } = await supabaseAdmin
      .from("shops").select("id, name, email, slug, owner_id, stripe_account_id").eq("id", appt.shop_id).single();
    if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (appt.payment_status === "refunded") return NextResponse.json({ error: "Already refunded." }, { status: 400 });
    if (!appt.payment_intent_id || !shop.stripe_account_id) {
      return NextResponse.json({ error: "No card charge to refund (e.g. cash). Refund it in person." }, { status: 400 });
    }

    try {
      await stripe.refunds.create({ payment_intent: appt.payment_intent_id }, { stripeAccount: shop.stripe_account_id });
    } catch (err) {
      if (!isAlreadyRefunded(err)) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Refund failed" }, { status: 500 });
      }
    }

    // Keep the appointment as-is (service happened) — only flag the money refunded.
    await supabaseAdmin.from("appointments").update({ payment_status: "refunded" }).eq("id", appointment_id);

    // In-app alert to owner + barber (realtime pop-up + chime).
    notifyRefundIssued({
      ownerId: shop.owner_id,
      barberId: appt.barber_id,
      clientName: appt.client_name,
      amountCents: Math.round((appt.total_amount ?? 0) * 100),
      date: appt.date,
    });

    if (appt.client_email) {
      fetch(`${BASE_URL}/api/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "refund_issued",
          data: {
            clientName: appt.client_name, clientEmail: appt.client_email,
            shopName: shop.name, shopEmail: shop.email ?? "", shopSlug: shop.slug,
            serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
            date: appt.date, total: `$${(appt.total_amount ?? 0).toFixed(2)}`,
          },
        }),
      }).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }

  // ── POS / standalone transaction refund ─────────────────────────────────────
  const { data: tx } = await supabaseAdmin
    .from("transactions").select("id, shop_id, payment_intent_id, refunded, amount, client_name, barber_id, created_at").eq("id", transaction_id!).single();
  if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id, stripe_account_id").eq("id", tx.shop_id).single();
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (tx.refunded) return NextResponse.json({ error: "Already refunded." }, { status: 400 });
  if (!tx.payment_intent_id || !shop.stripe_account_id) {
    return NextResponse.json({ error: "No card charge to refund (e.g. cash). Refund it in person." }, { status: 400 });
  }

  try {
    await stripe.refunds.create({ payment_intent: tx.payment_intent_id }, { stripeAccount: shop.stripe_account_id });
  } catch (err) {
    if (!isAlreadyRefunded(err)) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Refund failed" }, { status: 500 });
    }
  }
  await supabaseAdmin.from("transactions").update({ refunded: true }).eq("id", tx.id);
  notifyRefundIssued({
    ownerId: shop.owner_id,
    barberId: tx.barber_id,
    clientName: tx.client_name,
    amountCents: Math.round((tx.amount ?? 0) * 100),
    date: typeof tx.created_at === "string" ? tx.created_at.slice(0, 10) : null,
  });
  return NextResponse.json({ ok: true });
}
