import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hardwareCreditCents } from "@/lib/hardware-credit-config";

/**
 * Card-reader purchase incentive — "buy a WisePad 3, get up to 50% (max $50)
 * credited to your ClipWise plan."
 *
 * The barber buys the reader DIRECTLY from Stripe (they pay + own it + get the
 * tax invoice — see the hardware-shop embedded component on the Card Reader page).
 * ClipWise only rewards it with a one-time credit on the barber's OWN subscription
 * — a Stripe customer BALANCE credit on the platform account (negative balance ⇒
 * it comes off their next invoice). Never a charge, never touching the connected
 * account. Granted at most once per shop (phase62 `hardware_credit_granted`).
 *
 * NOTE: Stripe exposes no reliable way for a platform to see an account's
 * self-placed hardware order, so this is called from the hardware-shop purchase
 * event (go-live wiring). Kept a pure, guarded, best-effort helper so the caller
 * (and existing money flows) can never be broken by it.
 */

type GrantResult =
  | { ok: true; amountCents: number }
  | { ok: false; reason: "already_granted" | "no_subscription" | "error" };

/**
 * Grant the one-time card-reader credit to a shop's subscription. Idempotent,
 * best-effort, never throws — safe to call from a payment/event handler.
 */
export async function grantHardwareCredit(shopId: string): Promise<GrantResult> {
  try {
    const { data: shop } = await supabaseAdmin
      .from("shops")
      .select("id, stripe_customer_id, subscription_status, hardware_credit_granted")
      .eq("id", shopId)
      .maybeSingle();
    if (!shop) return { ok: false, reason: "error" };
    if (shop.hardware_credit_granted) return { ok: false, reason: "already_granted" };
    // The credit lands on the ClipWise subscription, so it needs a paying customer.
    if (!shop.stripe_customer_id) return { ok: false, reason: "no_subscription" };

    const amountCents = hardwareCreditCents();
    // Negative balance = account credit → applied to the customer's next invoice.
    // The idempotency key (one per shop) makes this at-most-once at Stripe: a
    // double-click, a racing second approval, or a retry after the flag write
    // below fails all resolve to the SAME single credit — never a double credit.
    await stripe.customers.createBalanceTransaction(shop.stripe_customer_id, {
      amount: -amountCents,
      currency: "cad",
      description: "Card reader credit (WisePad 3)",
    }, { idempotencyKey: `hardware-credit-${shopId}` });

    // Mark granted so it can never double-apply. Resilient to the phase62 columns
    // not being migrated yet (drop them and still set the flag).
    let upd = await supabaseAdmin.from("shops")
      .update({ hardware_credit_granted: true, hardware_credit_amount_cents: amountCents, hardware_credit_at: new Date().toISOString() })
      .eq("id", shopId);
    if (upd.error && /column|does not exist|schema cache/i.test(upd.error.message)) {
      upd = await supabaseAdmin.from("shops").update({ hardware_credit_granted: true }).eq("id", shopId);
    }
    if (upd.error) {
      // Credit was applied but the flag write failed — log so it can be reconciled;
      // don't throw. (Worst case a manual audit catches a rare double-credit.)
      console.error("[hardware-credit] granted but flag write failed:", upd.error.message);
    }
    return { ok: true, amountCents };
  } catch (err) {
    console.error("[hardware-credit] grant failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "error" };
  }
}
