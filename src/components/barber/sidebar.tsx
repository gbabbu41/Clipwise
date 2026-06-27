"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, CalendarDays, Clock, Users, DollarSign, User, LogOut, ChevronRight, Building2, CalendarOff, Menu, Bell, Calendar, CalendarX2, AlertTriangle, Info } from "lucide-react";
// Logo component no longer used — sidebar wordmark is an inline div now.
import { cn, timeAgo } from "@/lib/utils";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { ShopSwitcher } from "@/components/dashboard/shop-switcher";
import { DEFAULT_BARBER_PERMISSIONS, type BarberPermissions } from "@/lib/database.types";

// Notification visual config — one clean type-icon, tinted chip (mirrors owner).
const NOTIF_ICON: Record<string, { Icon: typeof Bell; cls: string }> = {
  booking:      { Icon: Calendar,      cls: "bg-emerald-500/15 text-emerald-400" },
  cancellation: { Icon: CalendarX2,    cls: "bg-rose-500/15 text-rose-400" },
  "no-show":    { Icon: AlertTriangle, cls: "bg-amber-500/15 text-amber-400" },
  system:       { Icon: Info,          cls: "bg-white/10 text-[#aaa]" },
};
const notifIcon = (type: string) => NOTIF_ICON[type] ?? NOTIF_ICON.system;
// Strip any leading emoji/symbol so the row shows one consistent icon.
const cleanNotifTitle = (t: string) => t.replace(/^[^A-Za-z0-9]+/, "").trim() || t;

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  permKey?: keyof BarberPermissions;
  badge?: boolean;
};

const navItems: NavItem[] = [
  { href: "/barber-dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/barber-dashboard/calendar", label: "Calendar", icon: CalendarDays },
  // Schedule = working hours (read-only unless edit_schedule is granted).
  { href: "/barber-dashboard/schedule", label: "Schedule", icon: Clock },
  { href: "/barber-dashboard/time-off", label: "Time Off", icon: CalendarOff, permKey: "request_time_off" },
  { href: "/barber-dashboard/clients", label: "My Clients", icon: Users, permKey: "view_clients" },
  { href: "/barber-dashboard/earnings", label: "Payments", icon: DollarSign, permKey: "view_earnings" },
  { href: "/barber-dashboard/notifications", label: "Notifications", icon: Bell, badge: true },
  { href: "/barber-dashboard/profile", label: "Profile", icon: User },
];

export function BarberSidebar() {
  const pathname = usePathname();
  const { user, profile, signOut } = useAuth();
  const { barber, shop, shops, setActiveShop } = useBarber();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Notifications (scoped to THIS barber's auth id) — mirrors the owner sidebar.
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  // Bottom-sheet notifications (mirrors the owner portal) with pull-down dismiss.
  const notifSheetRef = useRef<HTMLDivElement | null>(null);
  const { dragY: notifDragY, dragging: notifDragging } = useSheetDrag(
    notifSheetRef, () => setNotifOpen(false), { enabled: notifOpen },
  );
  const [recentNotifs, setRecentNotifs] = useState<{ id: string; title: string; message: string; type: string; is_read: boolean; created_at: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    const fetchCount = () => supabase
      .from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("is_read", false)
      .then(({ count }) => setUnreadCount(count ?? 0));
    fetchCount();
    const channel = supabase
      .channel(`barber-notifs:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, fetchCount)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Recent 5 for the popover — refetched whenever it opens / the count changes.
  useEffect(() => {
    if (!notifOpen || !user) return;
    supabase
      .from("notifications").select("id, title, message, type, is_read, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(15)
      .then(({ data }) => setRecentNotifs((data ?? []) as typeof recentNotifs));
  }, [notifOpen, user, unreadCount]);

  useEffect(() => { setNotifOpen(false); }, [pathname]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);
  useEffect(() => {
    if (mobileOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = original; };
    }
  }, [mobileOpen]);

  // `cw-toggle-sidebar` flips the drawer; `cw-open-sidebar` forces open
  // (back-compat). Listens for both.
  useEffect(() => {
    const open = () => setMobileOpen(true);
    const toggle = () => setMobileOpen(prev => !prev);
    window.addEventListener("cw-open-sidebar", open);
    window.addEventListener("cw-toggle-sidebar", toggle);
    return () => {
      window.removeEventListener("cw-open-sidebar", open);
      window.removeEventListener("cw-toggle-sidebar", toggle);
    };
  }, []);

  // Hide on scroll-down; also track "scrolled at all" so the hairline
  // border below the bar fades in only once content slides under it.
  const [topBarHidden, setTopBarHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 4);
      const delta = y - lastY;
      if (Math.abs(delta) < 6) return;
      if (delta > 0 && y > 40) setTopBarHidden(true);
      else if (delta < 0) setTopBarHidden(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const displayName = barber?.name ?? profile?.name ?? user?.email ?? "Barber";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile top bar — v2 header pattern: hamburger + ClipWise wordmark
          on the left, avatar pill on the right. Slides off on scroll-down. */}
      <div
        className={cn(
          "lg:hidden fixed top-0 left-0 right-0 z-30 h-14 flex items-center gap-2 pl-5 pr-3 bg-black/92 backdrop-blur-xl transition-all duration-200 border-b",
          scrolled ? "border-[#1e1e1e]" : "border-transparent",
          topBarHidden ? "-translate-y-full" : "translate-y-0",
        )}
      >
        <div className="flex-1" />
        {/* Notifications bell — same control as the owner mobile header,
            scoped to this barber. Red dot when there's anything unread. */}
        <button
          type="button"
          onClick={() => setNotifOpen(o => !o)}
          aria-label="Notifications"
          aria-expanded={notifOpen}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center text-white transition-colors relative flex-shrink-0",
            notifOpen ? "bg-white/10" : "hover:bg-white/5",
          )}
        >
          <Bell size={20} strokeWidth={2.5} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border border-black leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        {/* Account avatar — hidden on the profile page itself (you're already
            there) so it doesn't double up with the page's own avatar. */}
        {pathname !== "/barber-dashboard/profile" && (
          <Link
            href="/barber-dashboard/profile"
            aria-label="Account"
            className="w-9 h-9 rounded-full bg-white text-black font-extrabold text-[11px] flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0"
          >
            {initial}
          </Link>
        )}
      </div>

      {/* Notification sheet — slides up from the bottom (mirrors the owner
          portal). Pull down anywhere to dismiss, or tap the handle. */}
      <AnimatePresence>
        {notifOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
              onClick={() => setNotifOpen(false)}
            />
            <motion.div
              className="lg:hidden fixed inset-x-0 bottom-0 z-[80]"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "tween", duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              <div
                ref={notifSheetRef}
                className="bg-[#0c0c0c] border-t border-[#1e1e1e] rounded-t-2xl shadow-2xl flex flex-col max-h-[82vh] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                style={{
                  transform: notifDragY ? `translateY(${notifDragY}px)` : undefined,
                  transition: notifDragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)",
                }}
              >
                <div onClick={() => setNotifOpen(false)} className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing flex-shrink-0">
                  <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
                </div>
                <div className="px-4 pb-3 flex items-center justify-between flex-shrink-0">
                  <p className="text-base font-bold text-white">Notifications</p>
                  <Link href="/barber-dashboard/notifications" onClick={() => setNotifOpen(false)} className="text-xs font-semibold text-amber-400 hover:underline">See all</Link>
                </div>
                {recentNotifs.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[#888] text-sm">Nothing here yet</div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-[#1a1a1a]">
                    {recentNotifs.map(n => {
                      const { Icon, cls } = notifIcon(n.type);
                      return (
                        <Link key={n.id} href="/barber-dashboard/notifications" onClick={() => setNotifOpen(false)}
                          className={cn("flex gap-3 px-4 py-3.5 transition-colors active:bg-white/[0.06]", n.is_read ? "hover:bg-[#141414]" : "bg-white/[0.04] hover:bg-white/[0.07]")}>
                          <span className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", cls)}>
                            <Icon size={16} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className={cn("text-sm truncate", n.is_read ? "font-semibold text-[#cdcdcd]" : "font-bold text-white")}>{cleanNotifTitle(n.title)}</p>
                              <span className="text-[11px] text-[#888] flex-shrink-0">{timeAgo(n.created_at)}</span>
                            </div>
                            <p className="text-xs text-[#aaa] line-clamp-2 mt-0.5">{n.message}</p>
                          </div>
                          {!n.is_read && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-1.5" />}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-[55] animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-[60] w-64 h-screen flex flex-col bg-surface border-r border-border transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      {/* Sidebar wordmark — clean Sora 800 24px white, left-aligned. */}
      <div
        className="cw-logo-fade whitespace-nowrap border-b border-border"
        style={{
          fontFamily: "'Sora', sans-serif",
          fontWeight: 800,
          fontSize: "24px",
          letterSpacing: "1px",
          color: "#ffffff",
          padding: "20px",
        }}
      >
        CLIPWISE
      </div>

      {/* Reused from the owner sidebar — only renders when shops.length > 1 */}
      <ShopSwitcher shop={shop} shops={shops} setActiveShop={setActiveShop} />

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {navItems.filter(item => {
          if (!item.permKey) return true;
          const perms = barber?.permissions ?? DEFAULT_BARBER_PERMISSIONS;
          return perms[item.permKey] !== false;
        }).map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                isActive
                  ? "bg-white text-black border border-white"
                  : "text-[#777] hover:text-white hover:bg-[#141414]"
              )}
            >
              <Icon size={18} className={cn(isActive ? "text-black" : "text-[#777] group-hover:text-white")} />
              <span className="flex-1">{item.label}</span>
              {item.badge && unreadCount > 0 && (
                <span className={cn(
                  "text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center",
                  isActive ? "bg-black text-white" : "bg-white text-black",
                )}>{unreadCount}</span>
              )}
              {isActive && <ChevronRight size={14} className="text-black" />}
            </Link>
          );
        })}

        {/* Owner-also-barber: show a way back to the owner dashboard */}
        {profile?.role === "shop_owner" && (
          <Link href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-[#777] hover:text-white hover:bg-surface-raised mt-3 border-t border-border pt-4">
            <Building2 size={18} className="text-[#777] group-hover:text-white" />
            <span className="flex-1">Owner Dashboard</span>
            <ChevronRight size={14} className="opacity-50" />
          </Link>
        )}
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-white border border-white flex items-center justify-center text-black font-semibold text-sm">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-[#777]">{profile?.role === "shop_owner" ? "Owner · Barber" : "Barber"}</p>
          </div>
          <button onClick={signOut} className="text-[#777] hover:text-red-400 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}

export function BarberMobileNav() {
  const pathname = usePathname();
  const { barber } = useBarber();
  const perms = barber?.permissions ?? DEFAULT_BARBER_PERMISSIONS;
  // 4 page-links + 1 'More' drawer-opener. Payments hides when the perm
  // is off — list shrinks to 3 links + More to keep balance.
  const linkItems = [
    { href: "/barber-dashboard",          label: "Home",     icon: LayoutDashboard, show: true },
    { href: "/barber-dashboard/calendar", label: "Calendar", icon: CalendarDays,    show: true },
    { href: "/barber-dashboard/schedule", label: "Schedule", icon: Clock,           show: true },
    { href: "/barber-dashboard/earnings", label: "Payments", icon: DollarSign,      show: perms.view_earnings !== false },
  ].filter(i => i.show);
  const toggleDrawer = () => window.dispatchEvent(new Event("cw-toggle-sidebar"));

  return (
    <nav className="cw-bnav lg:hidden">
      {linkItems.map((item) => {
        const isActive = pathname === item.href
          || (item.href !== "/barber-dashboard" && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} className={cn("cw-ni", isActive && "active")}>
            <div className="cw-ni-icon"><item.icon size={20} /></div>
            <div className="cw-ni-label">{item.label}</div>
            {isActive && <div className="cw-ni-line" />}
          </Link>
        );
      })}
      {/* 'More' opens the sidebar drawer (Profile, Time Off, etc.). */}
      <button type="button" onClick={toggleDrawer} className="cw-ni" aria-label="Toggle menu">
        <div className="cw-ni-icon"><Menu size={20} /></div>
        <div className="cw-ni-label">More</div>
      </button>
    </nav>
  );
}
