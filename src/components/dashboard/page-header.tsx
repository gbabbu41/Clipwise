"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/avatar-image";

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
export function DashboardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { profile } = useAuth();
  const [unread, setUnread] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", profile.id).eq("is_read", false)
      .then(({ count }) => setUnread(count ?? 0));
    supabase.from("barbers").select("photo").eq("user_id", profile.id).limit(1).maybeSingle()
      .then(({ data }) => setPhoto((data as { photo?: string } | null)?.photo ?? null));
  }, [profile?.id]);

  const onBell = (e: React.MouseEvent) => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      e.preventDefault();
      window.dispatchEvent(new Event("cw-open-notifs"));
    }
  };

  return (
    <div className="cwd-hdr">
      <div className="min-w-0">
        <h1 className="truncate">{title}</h1>
        {subtitle && <p className="cwd-sub">{subtitle}</p>}
      </div>
      <div className="cwd-cluster">
        <Link href="/dashboard/notifications" aria-label="Notifications" className="cwd-icobtn" onClick={onBell}>
          <Bell size={17} />
          {unread > 0 && <span className="cwd-dot" />}
        </Link>
        <Link href="/dashboard/settings" aria-label="Account" className="cwd-avatar">
          <AvatarImage src={photo} alt={profile?.name ?? "Account"} className="w-full h-full object-cover"
            fallback={<>{(profile?.name ?? "U").charAt(0).toUpperCase()}</>} />
        </Link>
      </div>
    </div>
  );
}
