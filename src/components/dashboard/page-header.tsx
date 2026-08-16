"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { useShopUnreadCount } from "@/hooks/use-unread-count";
import { UnreadBadge } from "@/components/notification-badge";
import { ProfileMenu, OWNER_MENU_ITEMS } from "@/components/profile-menu";
import { cn } from "@/lib/utils";

/**
 * Owner-dashboard page header — the same clean top the home page uses: title
 * (+ optional subtitle) on the left, notification bell + profile on the right,
 * all on one row. The bell opens the notification popover on mobile (via the
 * `cw-open-notifs` event the sidebar listens for) and navigates on desktop.
 *
 * Pages that use this should also be listed in the layout's inline-header set
 * (so the mobile top band shrinks and the floating bell/profile is hidden),
 * keeping the top consistent with the dashboard home.
 */
export function DashboardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
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
    // The template owns its top spacing (pt-6 lg:pt-8) so every page that drops
    // in <DashboardHeader> sits at the same distance from the top — no per-page
    // padding to drift. Pages using it give their root horizontal padding only
    // (px-*, not p-*), otherwise the top would double up. The dashboard home
    // keeps its own inline copy of this markup, so it's unaffected by this.
    // On mobile the sticky top bar carries the title + bell + profile, so this
    // header defers to it there: the title/bell/profile are desktop-only, and the
    // whole header hides on mobile when there's nothing else to show (no subtitle,
    // no action) — leaving just the bar. The subtitle + any page action stay.
    <div className={cn("cwd-hdr pt-6 lg:pt-8", !subtitle && !action && "max-lg:hidden")}>
      <div className="min-w-0">
        <h1 className="truncate max-lg:hidden">{title}</h1>
        {subtitle && <p className="cwd-sub">{subtitle}</p>}
      </div>
      <div className="cwd-cluster">
        {/* Optional page action (e.g. "add"), sits left of the universal
            bell + profile so the right cluster stays consistent everywhere. */}
        {action}
        <Link href="/dashboard/notifications" aria-label="Notifications" className="cwd-icobtn relative max-lg:hidden" onClick={onBell}>
          <Bell size={17} />
          <UnreadBadge count={unread} />
        </Link>
        <ProfileMenu name={profile?.name ?? "Account"} photo={photo} items={OWNER_MENU_ITEMS} triggerClassName="cwd-avatar" className="max-lg:hidden" />
      </div>
    </div>
  );
}
