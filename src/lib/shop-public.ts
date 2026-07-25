// Strip a shop row of its sensitive Stripe identifiers before returning it to a
// non-owner (a staff barber) or any client response. These are internal linkage
// ids, not needed by barber-facing UI. Done by deletion (not an allow-list) so
// adding a new shop column never accidentally starts leaking — and never breaks
// a caller that expected a field.
const SECRET_SHOP_FIELDS = [
  "stripe_account_id",
  "stripe_customer_id",
  "stripe_subscription_id",
] as const;

export function stripShopSecrets<T extends Record<string, unknown> | null | undefined>(shop: T): T {
  if (!shop) return shop;
  const copy = { ...(shop as Record<string, unknown>) };
  for (const k of SECRET_SHOP_FIELDS) delete copy[k];
  return copy as T;
}
