import { stripe } from "@/lib/stripe";

/**
 * After an upgrade/switch creates a NEW subscription, cancel every OTHER active
 * subscription on the same Stripe customer so the owner is never billed twice.
 *
 * A plan change creates a FRESH subscription; the previous one must be cancelled
 * or it keeps billing forever. Two checkouts (two tabs / back button) can each
 * spawn a subscription, so we sweep ALL active subs except the new one — not just
 * the single id captured at checkout. Add-ons are line items on the ONE
 * subscription (never separate subs), so the only "other" active sub is a
 * duplicate that must go.
 *
 * Best-effort per subscription, but real failures are LOGGED (not silently
 * swallowed) so a lingering duplicate is visible instead of quietly double-billing.
 * Runs in both the return-from-checkout route (synchronous) and the Stripe
 * webhook (for owners who close the tab and never return) — either path alone
 * fully cancels the old plan.
 */
export async function cancelDuplicateSubscriptions(
  customerId: string | null,
  newSubId: string | null,
  oldSubId?: string | null,
): Promise<void> {
  if (!newSubId) return;

  const cancelOne = async (id: string) => {
    try {
      await stripe.subscriptions.cancel(id);
    } catch (e) {
      const err = e as { code?: string; raw?: { code?: string }; message?: string };
      const code = err?.code ?? err?.raw?.code ?? "";
      const benign = /resource_missing|no such subscription|already canceled|already cancelled/i
        .test(`${code} ${err?.message ?? ""}`);
      if (!benign) console.warn(`[subscriptions] failed to cancel duplicate ${id}:`, err?.message ?? code);
    }
  };

  if (customerId) {
    try {
      const others = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 100 });
      for (const s of others.data) {
        if (s.id !== newSubId) await cancelOne(s.id);
      }
    } catch (e) {
      console.warn("[subscriptions] could not list customer subscriptions for cleanup:",
        e instanceof Error ? e.message : String(e));
    }
  }

  // Backstop: the specific old sub captured at checkout may not have been in the
  // "active" list above (e.g. trialing / past_due) — cancel it explicitly too.
  if (oldSubId && oldSubId !== newSubId) await cancelOne(oldSubId);
}
