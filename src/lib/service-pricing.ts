// Server-only — resolve the authoritative price + duration for a set of services
// straight from the DB. Booking routes must NEVER charge or store a client-sent
// subtotal/total_amount (a customer will POST total_amount: 0.50 for a $60 cut).
// This sums the real prices, scoped to the shop so a client can't reference
// another shop's cheaper service.
import { supabaseAdmin } from "./supabase-admin";

export interface ResolvedServiceCharge {
  subtotal: number;      // dollars — summed real prices (honors duplicates)
  duration: number;      // minutes — summed real durations
  count: number;         // how many requested ids actually resolved
  allResolved: boolean;  // false if ANY requested id isn't a service of this shop
}

/**
 * `serviceIds` is a multiset — the same service may appear more than once (a
 * customer can book two of the same). Prices/durations are summed per
 * occurrence. If any id doesn't belong to the shop, `allResolved` is false so
 * the caller can reject rather than silently undercharge.
 */
export async function resolveServiceCharge(
  shopId: string,
  serviceIds: (string | null | undefined)[],
): Promise<ResolvedServiceCharge> {
  const ids = serviceIds.filter((x): x is string => !!x);
  if (ids.length === 0) return { subtotal: 0, duration: 0, count: 0, allResolved: false };

  const unique = Array.from(new Set(ids));
  const { data } = await supabaseAdmin
    .from("services").select("id, price, duration_minutes")
    .eq("shop_id", shopId).in("id", unique);

  const byId = new Map((data ?? []).map(s => [s.id as string, s]));
  let subtotal = 0, duration = 0, count = 0;
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    count++;
    subtotal += Number(s.price) || 0;
    duration += Number(s.duration_minutes) || 0;
  }
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    duration,
    count,
    allResolved: count === ids.length,
  };
}
