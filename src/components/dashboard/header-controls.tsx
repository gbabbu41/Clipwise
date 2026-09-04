"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { useShopUnreadCount } from "@/hooks/use-unread-count";
import { UnreadBadge } from "@/components/notification-badge";
import { ProfileMenu, OWNER_MENU_ITEMS } from "@/components/profile-menu";

/**
 * The universal owner top-right controls — notification bell + profile menu.
 * Extracted so both the page header (<DashboardHeader>) and pages that build
 * their own top row (the calendar toolbar) render the exact same bell + avatar
 * from one source of truth. Desktop-only (max-lg:hidden): on mobile the
 * sidebar's fixed top bar carries these instead, so they must never double up.
 */
export function HeaderControls() {
  const { profile, shop } = useAuth();
  // Shared live count (initial fetch + realtime) so this bell matches every other
  // bell and decrements the instant a notification is read.
  const unread = useShopUnreadCount(profile?.id, shop?.id);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    // Scope the avatar to this shop's barber row too (an owner who is a barber at
    // multiple shops otherwise gets an arbitrary shop's photo).
    let q = supabase.from("barbers").select("photo").eq("user_id", profile.id);
    if (shop?.id) q = q.eq("shop_id", shop.id);
    q.limit(1).maybeSingle().then(({ data }) => setPhoto((data as { photo?: string } | null)?.photo ?? null));
  }, [profile?.id, shop?.id]);

  const onBell = (e: React.MouseEvent) => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      e.preventDefault();
      window.dispatchEvent(new Event("cw-open-notifs"));
    }
  };

  return (
    <>
      <Link href="/dashboard/notifications" aria-label="Notifications" className="cwd-icobtn relative max-lg:hidden" onClick={onBell}>
        <Bell size={17} />
        <UnreadBadge count={unread} />
      </Link>
      <ProfileMenu name={profile?.name ?? "Account"} photo={photo} items={OWNER_MENU_ITEMS} triggerClassName="cwd-avatar" className="max-lg:hidden" />
    </>
  );
}
