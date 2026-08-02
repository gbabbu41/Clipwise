// Server-only — record a post-visit tip into our DB from a settled Stripe tip
// checkout. Shared by BOTH the webhook (flow=tip) AND the customer-return
// tip-finalize route, so a tip is captured even when the connected-account
// webhook never arrives (the exact failure that made tips vanish on the barber
// side). Keeping it in one place means the two paths can never drift apart.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordOnlinePaymentTx } from "@/lib/finalize-appointment-payment";
import { insertNotifications } from "@/lib/notify-server";

/**
 * Turn a paid tip checkout into a ledger row + appointment tip bump + owner
 * alert. Idempotent: keyed on the PaymentIntent, so whichever path runs second
 * (webhook vs. the customer returning from Checkout) is a clean no-op — no
 * double ledger row and no double-counted tip_amount.
 *
 * Returns { recorded: true } only on the call that actually wrote the tip.
 */
export async function recordTipFromCheckout(args: {
  appointmentId: string;
  shopId: string;
  barberId: string | null;
  clientName: string | null;
  tipDollars: number;
  paymentIntentId: string | null;
}): Promise<{ recorded: boolean }> {
  const { appointmentId, shopId, barberId, clientName, paymentIntentId } = args;
  const tipDollars = Number(args.tipDollars ?? 0);
  if (!shopId || !appointmentId || tipDollars <= 0 || !paymentIntentId) return { recorded: false };

  // Dedup on the PaymentIntent — this guard wraps the whole operation (ledger
  // row AND the tip bump) so a second delivery never double-counts. Mirrors the
  // dedup the booking/gift finalize paths use.
  const { data: dup } = await supabaseAdmin
    .from("transactions").select("id").eq("payment_intent_id", paymentIntentId).limit(1);
  if ((dup?.length ?? 0) > 0) return { recorded: false };

  // Ledger row so the barber portal + analytics see the tip (source=completion,
  // so the owner feed de-dupes it against the appointment). amount is 0 — a tip
  // is pure tip, not service revenue.
  await recordOnlinePaymentTx({
    appointmentId,
    shopId,
    barberId: barberId || null,
    clientName: clientName || null,
    serviceName: "Tip",
    amountDollars: 0,
    tipDollars,
    paymentIntentId,
  });

  // Roll the tip into the appointment's running total (best-effort).
  const { data: cur } = await supabaseAdmin
    .from("appointments").select("tip_amount").eq("id", appointmentId).maybeSingle();
  if (cur) {
    await supabaseAdmin.from("appointments")
      .update({ tip_amount: Number(cur.tip_amount ?? 0) + tipDollars }).eq("id", appointmentId).then(null, () => null);
  }

  // "Tip received 🎉" pop-up for the owner (best-effort).
  const { data: shop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", shopId).maybeSingle();
  if (shop?.owner_id) {
    insertNotifications({
      user_id: shop.owner_id, shop_id: shopId, title: "Tip received",
      message: `${clientName || "A customer"} left a $${tipDollars.toFixed(2)} tip. 🎉`,
      type: "system",
    });
  }
  return { recorded: true };
}
