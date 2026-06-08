import { supabaseAdmin } from "@/lib/supabase-admin";

// Shared payment-notification helpers used by the capture-appointment route
// (manual Complete / Charge No-Show) and the no-show cron, so both paths send
// the same customer receipt and the same owner failure alert. Both are
// fire-and-forget and never throw — a notification failure must not roll back
// a real charge.

export async function sendPaymentReceipt(baseUrl: string, args: {
  clientEmail?: string | null;
  clientName?: string | null;
  shopName?: string | null;
  shopEmail?: string | null;
  serviceName?: string | null;
  date?: string | null;
  amountCents: number;
  context: string; // human label, e.g. "Appointment completed" | "No-show fee"
}): Promise<void> {
  if (!args.clientEmail || args.amountCents <= 0) return;
  await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "payment_receipt",
      data: {
        clientEmail: args.clientEmail,
        clientName: args.clientName ?? "there",
        shopName: args.shopName ?? "",
        shopEmail: args.shopEmail ?? "",
        serviceName: args.serviceName ?? "",
        date: args.date ?? "",
        amount: `$${(args.amountCents / 100).toFixed(2)}`,
        context: args.context,
      },
    }),
  }).catch(() => null);
}

/**
 * In-app (web) success alert when a no-show fee is charged — to the owner AND
 * the assigned barber. Intentionally in-app ONLY (no email/SMS): it drives the
 * realtime portal pop-up + chime via the notifications table. Uses the
 * CHECK-allowed "no-show" notification type.
 */
export async function notifyNoShowCharged(args: {
  ownerId?: string | null;
  barberId?: string | null;   // barbers.id (resolved to its linked user)
  clientName?: string | null;
  amountCents?: number;
  date?: string | null;
}): Promise<void> {
  const amt = args.amountCents ? ` $${(args.amountCents / 100).toFixed(2)}` : "";
  const message = `Charged ${args.clientName ?? "a client"}'s card${amt} for a no-show${args.date ? ` on ${args.date}` : ""}.`;

  const recipients = new Set<string>();
  if (args.ownerId) recipients.add(args.ownerId);
  if (args.barberId) {
    const { data: b } = await supabaseAdmin.from("barbers").select("user_id").eq("id", args.barberId).maybeSingle();
    if (b?.user_id) recipients.add(b.user_id);
  }
  if (recipients.size === 0) return;

  await supabaseAdmin.from("notifications").insert(
    Array.from(recipients).map(uid => ({
      user_id: uid,
      title: "✅ No-show fee charged",
      message,
      type: "no-show",
      is_read: false,
    })),
  ).then(null, () => null);
}

export async function notifyChargeFailed(args: {
  ownerId?: string | null;
  clientName?: string | null;
  amountCents?: number;
  reason: "completed" | "no_show";
}): Promise<void> {
  if (!args.ownerId) return;
  const amt = args.amountCents ? ` ($${(args.amountCents / 100).toFixed(2)})` : "";
  const what = args.reason === "no_show" ? "no-show fee" : "completion charge";
  // notifications.type is CHECK-constrained — 'system' is the right bucket for
  // an ops alert the owner needs to act on.
  await supabaseAdmin.from("notifications").insert({
    user_id: args.ownerId,
    title: "⚠️ Card charge failed",
    message: `Couldn't charge ${args.clientName ?? "a client"}'s card for the ${what}${amt}. Open the appointment to retry or take payment another way.`,
    type: "system",
    is_read: false,
  }).then(null, () => null);
}
