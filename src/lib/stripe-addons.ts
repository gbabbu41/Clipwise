// Server-only — the "additional location" subscription add-on.
//
// Owners get 2 locations on Premium ($79). Each location beyond the plan's
// included count is a $30/mo add-on billed on the owner's SAME subscription as
// a second line item whose quantity = number of extra locations. We reconcile
// that quantity from the real shop count, so it's always correct after any
// add/remove and there's never a second checkout.
import { stripe } from "./stripe";

// $30/mo CAD per extra location.
export const LOCATION_ADDON_CENTS = 3000;

// Stable lookup key so we find-or-create ONE reusable price (per Stripe mode).
const LOOKUP_KEY = "clipwise_location_addon_monthly_cad";

/** The reusable recurring Price for the location add-on, created lazily the
 *  first time it's needed (works in test and live without any dashboard step). */
async function getLocationAddonPriceId(): Promise<string> {
  const found = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  try {
    const price = await stripe.prices.create({
      currency: "cad",
      unit_amount: LOCATION_ADDON_CENTS,
      recurring: { interval: "month" },
      lookup_key: LOOKUP_KEY,
      product_data: { name: "ClipWise — Additional Location" },
    });
    return price.id;
  } catch {
    // Lost a create race (lookup_key already taken) — re-read and use it.
    const retry = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
    if (retry.data[0]) return retry.data[0].id;
    throw new Error("Could not resolve the location add-on price");
  }
}

/**
 * Make the owner's subscription carry exactly `extraLocations` add-on units.
 * Idempotent: adds the item, changes its quantity, or removes it to match.
 * Proration accrues to the next invoice (no immediate charge attempt, so it
 * can't decline at call time). Throws on Stripe error — callers decide whether
 * to proceed (add-location bills BEFORE creating the shop and rolls back).
 */
export async function reconcileLocationAddon(subscriptionId: string, extraLocations: number): Promise<void> {
  const qty = Math.max(0, Math.floor(extraLocations));
  const priceId = await getLocationAddonPriceId();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data.find((i) => i.price?.id === priceId);

  if (qty === 0) {
    if (item) await stripe.subscriptionItems.del(item.id, { proration_behavior: "create_prorations" });
    return;
  }
  if (item) {
    if (item.quantity !== qty) {
      await stripe.subscriptionItems.update(item.id, { quantity: qty, proration_behavior: "create_prorations" });
    }
  } else {
    await stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price: priceId,
      quantity: qty,
      proration_behavior: "create_prorations",
    });
  }
}
