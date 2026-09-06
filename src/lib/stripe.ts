import Stripe from "stripe";

// Server-only — never import in "use client" components.
// apiVersion is pinned EXPLICITLY (matches this SDK's default) so a future
// `stripe` package bump can't silently move the API version under us and change
// behaviour. Bump this deliberately, together with the SDK, after testing.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia",
});

/**
 * True when running on LIVE Stripe keys (real money). Used to gate the
 * platform-charge fallback: in test/sandbox we let an un-onboarded shop fall
 * back to a platform charge so demos work without KYC, but with real money we
 * must NEVER do that — block online payment until the shop completes Connect,
 * otherwise the customer is charged and the funds land in the platform account
 * instead of the shop's.
 */
export const STRIPE_LIVE_MODE = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");

/**
 * The REAL processing fee (in cents) Stripe charged on a payment, read from the
 * charge's balance_transaction. For Connect direct charges the balance
 * transaction lives on the CONNECTED account, so pass that account id (the same
 * `{ stripeAccount }` context the charge was created with); pass null for a
 * platform charge (test-mode fallback). Best-effort: returns 0 on any problem so
 * fee capture can never break a payment or a ledger write.
 */
export async function stripeFeeCents(
  paymentIntentId: string | null | undefined,
  connectedAccountId: string | null | undefined,
): Promise<number> {
  if (!paymentIntentId) return 0;
  try {
    const opts = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
    const pi = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["latest_charge.balance_transaction"] },
      opts,
    );
    const charge = pi.latest_charge;
    if (!charge || typeof charge === "string") return 0;
    const bt = (charge as Stripe.Charge).balance_transaction;
    if (!bt || typeof bt === "string") return 0;
    const fee = (bt as Stripe.BalanceTransaction).fee;
    return typeof fee === "number" && fee > 0 ? fee : 0;
  } catch {
    return 0;
  }
}

// Monthly subscription pricing (in cents, CAD)
export const PLAN_PRICING: Record<string, { amount: number; name: string }> = {
  pro: { amount: 2300, name: "ClipWise Pro" },
  premium: { amount: 7900, name: "ClipWise Premium" },
};
