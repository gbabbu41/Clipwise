import { stripe } from "@/lib/stripe";
import type { ByPi } from "@/lib/revenue";

/**
 * Build the paymentIntent -> { gross, fee, net } map for a connected account from
 * its Stripe balance transactions — the EXACT fee/net Stripe took, the same data
 * the owner's Payments page uses. Shared so the barber portal nets fees from the
 * SAME live source instead of a stale stored `stripe_fee` column (which is often
 * 0 on older rows), keeping the owner's and the barber's numbers in agreement.
 *
 * Best-effort: returns whatever it gathered (or {}) on any error — a fee lookup
 * must never break an earnings read. Bounded by DATE (default ~13 months) so it
 * can't run away on a high-volume account.
 */
export async function fetchStripeByPi(
  stripeAccountId: string | null | undefined,
  sinceSec?: number,
): Promise<ByPi> {
  const byPi: ByPi = {};
  if (!stripeAccountId) return byPi;
  const opts = { stripeAccount: stripeAccountId };
  const gte = sinceSec ?? Math.floor(Date.now() / 1000) - 400 * 86400;
  try {
    let startingAfter: string | undefined;
    for (let page = 0; page < 60; page++) {
      const list = await stripe.balanceTransactions.list(
        { limit: 100, created: { gte }, expand: ["data.source"], ...(startingAfter ? { starting_after: startingAfter } : {}) },
        opts,
      );
      for (const bt of list.data) {
        const src = bt.source as { payment_intent?: string | null } | null;
        const pi = src && typeof src === "object" ? src.payment_intent ?? null : null;
        if (pi) byPi[pi] = { gross: bt.amount / 100, fee: bt.fee / 100, net: bt.net / 100 };
      }
      if (!list.has_more) break;
      startingAfter = list.data[list.data.length - 1]?.id;
    }
  } catch {
    /* return whatever we have — fees just fall back to the stored value */
  }
  return byPi;
}
