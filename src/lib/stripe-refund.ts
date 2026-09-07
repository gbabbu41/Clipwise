import { stripe } from "@/lib/stripe";

/**
 * Stripe throws when a charge was already refunded (e.g. an earlier attempt
 * went through but our record drifted). Treat that as success and sync.
 */
export function isAlreadyRefunded(err: unknown): boolean {
  const e = err as { code?: string; raw?: { code?: string }; message?: string };
  const code = e?.code ?? e?.raw?.code ?? "";
  return code === "charge_already_refunded" || /already been refunded|already refunded/i.test(e?.message ?? "");
}

/**
 * Refund a captured card payment — OR release it if the card was only HELD
 * (uncaptured). A no-show hold has no settled charge, so `refunds.create` would
 * error with a 500 ("cannot refund an uncaptured PaymentIntent"). In that case
 * we cancel the PaymentIntent instead: the authorization is released, $0 moves,
 * and the customer's held funds free up.
 *
 * Returns the cents actually refunded (0 when a hold was released), whether it
 * was a hold release, and whether Stripe reported the charge as already refunded
 * (treat that as success — the caller keeps its own amount fallback).
 */
export async function refundOrReleaseHold(
  paymentIntentId: string,
  stripeAccount: string,
  idempotencyKey: string,
): Promise<{ refundedCents: number | null; released: boolean; alreadyRefunded: boolean }> {
  const acct = { stripeAccount };

  // Is the payment only held (not captured)? Those statuses can be cancelled but
  // never refunded. Best-effort: if the retrieve fails, fall through to a normal
  // refund attempt (the old behavior).
  let uncaptured = false;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, undefined, acct);
    uncaptured = pi.status === "requires_capture"
      || pi.status === "requires_confirmation"
      || pi.status === "requires_payment_method";
  } catch { /* fall through */ }

  if (uncaptured) {
    try {
      await stripe.paymentIntents.cancel(paymentIntentId, undefined, acct);
      return { refundedCents: 0, released: true, alreadyRefunded: false };
    } catch (err) {
      if (isAlreadyRefunded(err)) return { refundedCents: null, released: false, alreadyRefunded: true };
      // Captured in the race between retrieve and cancel → fall through to refund.
    }
  }

  try {
    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId }, { ...acct, idempotencyKey });
    return { refundedCents: typeof refund.amount === "number" ? refund.amount : null, released: false, alreadyRefunded: false };
  } catch (err) {
    if (isAlreadyRefunded(err)) return { refundedCents: null, released: false, alreadyRefunded: true };
    throw err;
  }
}
