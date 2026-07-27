import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyRefundIssued } from "@/lib/payment-notify";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

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

  // 30-day window
  const apptDate = new Date(appt.date);
  const daysSince = (Date.now() - apptDate.getTime()) / 86400000;
  if (daysSince > 30) return NextResponse.json({ error: "Refunds are only available within 30 days of the appointment." }, { status: 400 });

  if (appt.payment_status === "refunded") return NextResponse.json({ error: "This appointment was already refunded." }, { status: 400 });

  try {
    // Real Stripe refund when there's a captured payment on the connected account
    if (appt.payment_intent_id && shop.stripe_account_id) {
      try {
        await stripe.refunds.create(
          { payment_intent: appt.payment_intent_id },
          { stripeAccount: shop.stripe_account_id }
        );
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

    // In-app alert to owner + barber (realtime pop-up + chime).
    notifyRefundIssued({
      ownerId: shop.owner_id,
      barberId: appt.barber_id,
      clientName: appt.client_name,
      amountCents: Math.round((appt.total_amount ?? 0) * 100),
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
            total: `$${(appt.total_amount ?? 0).toFixed(2)}`,
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
