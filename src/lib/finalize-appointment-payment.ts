// Server-only — shared "mark an appointment paid (via online link/checkout)"
// used by payment-link-finalize (customer returns) and reconcile-payments
// (owner-side catch-up). Flips unpaid→paid idempotently and fires the receipt +
// owner/barber alerts ONLY on the real transition, so it can't double-notify.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReceipt, notifyNoShowCharged } from "@/lib/payment-notify";

export interface PayableAppt {
  id: string;
  barber_id: string | null;
  client_name: string | null;
  client_email: string | null;
  date: string;
  time_slot: string;
  total_amount: number | null;
  status?: string | null;
  services?: { name?: string } | { name?: string }[] | null;
}
export interface PayShop {
  name: string | null;
  email: string | null;
  owner_id: string | null;
}

export function serviceNameOf(rel: PayableAppt["services"]): string {
  return Array.isArray(rel) ? (rel[0]?.name ?? "Service") : (rel?.name ?? "Service");
}

/**
 * Flip an appointment unpaid→paid (idempotent via a conditional update). Returns
 * true only when THIS call performed the transition — in which case it also
 * sends the customer receipt, the owner+barber in-app "Payment collected"
 * pop-up, and the owner "payment received" email.
 */
export async function markAppointmentPaid(args: {
  appt: PayableAppt;
  shop: PayShop;
  baseUrl: string;
  paymentIntentId?: string | null;
}): Promise<boolean> {
  const { appt, shop, baseUrl, paymentIntentId } = args;

  const { data: claimed } = await supabaseAdmin
    .from("appointments")
    .update({
      payment_status: "paid",
      payment_method: "online",
      paid_at: new Date().toISOString(),
      // A pending pay-in-person booking that gets paid is now confirmed — no
      // separate manual approval needed once money is in.
      ...(appt.status === "pending" ? { status: "confirmed" } : {}),
      ...(paymentIntentId ? { payment_intent_id: paymentIntentId } : {}),
    })
    .eq("id", appt.id)
    .neq("payment_status", "paid")
    .select("id");

  if ((claimed?.length ?? 0) === 0) return false;

  const serviceName = serviceNameOf(appt.services);
  const amountCents = Math.round(Number(appt.total_amount ?? 0) * 100);

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

  notifyNoShowCharged({
    ownerId: shop.owner_id,
    barberId: appt.barber_id,
    clientName: appt.client_name,
    amountCents,
    date: appt.date,
    kind: "completed",
  });

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

  return true;
}
