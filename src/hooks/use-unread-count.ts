"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchShopUnreadCount } from "@/lib/notify";

/**
 * Live shop-scoped UNREAD notification count — the ONE source every bell uses so
 * the badge is identical across the portals and updates instantly: it re-fetches
 * on the initial mount, when a notification arrives, and when one is marked read
 * (postgres_changes can only filter by user_id, so we recompute the shop-scoped
 * count on any change — same rule as fetchShopUnreadCount). Pass the signed-in
 * user's id + the active shop id.
 */
export function useShopUnreadCount(userId?: string | null, shopId?: string | null): number {
  const [count, setCount] = useState(0);
  // Unique channel per hook instance so two bells on one page never collide.
  const chanId = useRef(`notif-count:${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    if (!userId) { setCount(0); return; }
    let active = true;
    const refresh = () => { fetchShopUnreadCount(supabase, userId, shopId).then(c => { if (active) setCount(c); }); };
    refresh();
    const ch = supabase
      .channel(chanId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [userId, shopId]);
  return count;
}
