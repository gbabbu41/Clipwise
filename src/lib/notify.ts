import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared notification helpers — CLIENT-SAFE (read helpers + pure fns only). The
 * server-only writer `insertNotifications` lives in `lib/notify-server.ts` so
 * this file never imports `supabaseAdmin`; importing that service-role client
 * into a browser bundle throws "supabaseKey is required" and blanks the page.
 * A notification belongs to ONE shop (shop_id) so a multi-shop owner's alerts
 * don't bleed across shops. Everything here is resilient to the `shop_id` (and
 * `entity_*`) columns not existing yet in prod, so a deploy that lands before
 * the phase32 migration degrades gracefully instead of breaking notifications.
 */

export type NotificationInput = {
  user_id: string;
  shop_id?: string | null;
  title: string;
  message: string;
  type: string;
  is_read?: boolean;
  entity_type?: string;
  entity_id?: string;
};

/**
 * Fetch a user's notifications scoped to the active shop, resilient to the
 * shop_id column not existing. Keeps NULL-shop (legacy / un-attributable) rows
 * visible so nothing vanishes. Used by every notification-reading surface so the
 * scoping rule lives in ONE place.
 */
export async function fetchShopNotifications(
  client: SupabaseClient,
  opts: { userId: string; shopId?: string | null; columns?: string; limit?: number; unreadOnly?: boolean },
): Promise<{ data: Record<string, unknown>[] | null; error: unknown }> {
  const build = (scoped: boolean) => {
    let q = client.from("notifications").select(opts.columns ?? "*").eq("user_id", opts.userId);
    if (opts.unreadOnly) q = q.eq("is_read", false);
    if (scoped && opts.shopId) q = q.or(`shop_id.eq.${opts.shopId},shop_id.is.null`);
    q = q.order("created_at", { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    return q;
  };
  const res = await build(true);
  if (res.error && /shop_id/.test((res.error as { message?: string }).message ?? "")) {
    return (await build(false)) as { data: Record<string, unknown>[] | null; error: unknown };
  }
  return res as { data: Record<string, unknown>[] | null; error: unknown };
}

/** Unread count scoped to the active shop, resilient to the column not existing. */
export async function fetchShopUnreadCount(
  client: SupabaseClient,
  userId: string,
  shopId?: string | null,
): Promise<number> {
  const build = (scoped: boolean) => {
    let q = client.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("is_read", false);
    if (scoped && shopId) q = q.or(`shop_id.eq.${shopId},shop_id.is.null`);
    return q;
  };
  const res = await build(true);
  if (res.error && /shop_id/.test(res.error.message ?? "")) {
    const fb = await build(false);
    return fb.count ?? 0;
  }
  return res.count ?? 0;
}

/** True when a realtime notification row belongs to the active shop (or is a
 *  legacy/unattributed NULL-shop row, which we still surface). Lets realtime
 *  subscriptions keep their simple user_id filter and gate per-shop client-side
 *  (Supabase postgres_changes can't do an OR/null filter). */
export function notifBelongsToShop(row: { shop_id?: string | null } | null | undefined, shopId?: string | null): boolean {
  if (!row) return false;
  if (!shopId) return true;                 // no active shop context → don't hide
  return row.shop_id == null || row.shop_id === shopId;
}
