"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, CalendarDays, Clock, Users, DollarSign, User, LogOut, ChevronRight, Building2, CalendarOff, Menu, Bell, Calendar, CalendarX2, AlertTriangle, Info, ListOrdered, PanelLeft, PanelLeftClose } from "lucide-react";
// Logo component no longer used — sidebar wordmark is an inline div now.
import { cn, timeAgo } from "@/lib/utils";
import { UnreadBadge } from "@/components/notification-badge";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { WaitlistAssignSheet, type WaitlistRequest } from "@/components/waitlist-assign-sheet";
import { AvatarImage } from "@/components/ui/avatar-image";
import { ProfileMenu, barberMenuItems } from "@/components/profile-menu";
import { shareLink } from "@/lib/share";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { fetchShopNotifications, fetchShopUnreadCount } from "@/lib/notify";
import { ShopSwitcher } from "@/components/dashboard/shop-switcher";
import { PortalThemeToggle } from "@/components/portal-theme";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DEFAULT_BARBER_PERMISSIONS, type BarberPermissions } from "@/lib/database.types";

// Notification visual config — one clean type-icon, tinted chip (mirrors owner).
const NOTIF_ICON: Record<string, { Icon: typeof Bell; cls: string }> = {
  booking:      { Icon: Calendar,      cls: "bg-emerald-500/15 text-emerald-400" },
  cancellation: { Icon: CalendarX2,    cls: "bg-rose-500/15 text-rose-400" },
  "no-show":    { Icon: AlertTriangle, cls: "bg-amber-500/15 text-amber-400" },
  system:       { Icon: Info,          cls: "bg-white/10 text-grey" },
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
  { href: "/barber-dashboard/waitlist", label: "Walk-Ins", icon: ListOrdered, permKey: "manage_appointments" },
  // Schedule = working hours (read-only unless edit_schedule is granted).
  { href: "/barber-dashboard/schedule", label: "Schedule", icon: Clock },
  { href: "/barber-dashboard/time-off", label: "Time Off", icon: CalendarOff, permKey: "request_time_off" },
  { href: "/barber-dashboard/clients", label: "My Clients", icon: Users, permKey: "view_clients" },
  { href: "/barber-dashboard/earnings", label: "Payments", icon: DollarSign, permKey: "view_earnings" },
  { href: "/barber-dashboard/notifications", label: "Notifications", icon: Bell, badge: true },
  { href: "/barber-dashboard/profile", label: "Profile", icon: User },
];

// Title shown in the mobile top bar per route — gives every page (the calendar
// included, which has no inline heading) a title beside the bell, matching the
// shop portal's one-row "title · bell · profile" top.
const BAR_TITLE: Record<string, string> = {
  "/barber-dashboard": "Home",
  "/barber-dashboard/calendar": "Calendar",
  "/barber-dashboard/waitlist": "Walk-Ins",
  "/barber-dashboard/schedule": "Schedule",
  "/barber-dashboard/time-off": "Time Off",
  "/barber-dashboard/clients": "My Clients",
  "/barber-dashboard/earnings": "Payments",
  "/barber-dashboard/notifications": "Notifications",
  "/barber-dashboard/profile": "My Profile",
  "/barber-dashboard/hours": "Hours",
};

export function BarberSidebar() {
  const pathname = usePathname();
  const { user, profile, signOut, accessToken } = useAuth();
  const { barber, shop, shops, setActiveShop } = useBarber();
  const { confirm } = useConfirm();
  // Confirm before signing out so a stray tap on the icon doesn't boot the barber.
  const confirmSignOut = async () => {
    if (await confirm({ title: "Sign out?", message: "You'll need to sign in again to get back in.", confirmText: "Sign out", cancelText: "Stay signed in" })) signOut();
  };
  const slotInterval = (shop?.booking_settings as { slot_interval_minutes?: number } | null)?.slot_interval_minutes ?? 30;
  const [assignReq, setAssignReq] = useState<WaitlistRequest | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Notifications (scoped to THIS barber's auth id) — mirrors the owner sidebar.
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  // Bottom-sheet notifications (mirrors the owner portal) with pull-down dismiss.
  const notifSheetRef = useRef<HTMLDivElement | null>(null);
  const { dragY: notifDragY, dragging: notifDragging } = useSheetDrag(
    notifSheetRef, () => setNotifOpen(false), { enabled: notifOpen },
  );
  const [recentNotifs, setRecentNotifs] = useState<{ id: string; title: string; message: string; type: string; is_read: boolean; created_at: string; entity_type?: string | null; entity_id?: string | null }[]>([]);
  // Open the assign sheet for a waitlist notification (barber can't read the
  // row directly — RLS is owner-only — so fetch it via the authorized route).
  const openAssign = async (entityId: string) => {
    if (!accessToken) return;
    const r = await fetch("/api/waitlist/get", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ id: entityId }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.request && d.request.status !== "converted") {
      setAssignReq(d.request as WaitlistRequest);
      setNotifOpen(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    // Scoped to the barber's active shop (a barber at multiple shops doesn't see
    // the other shop's alerts in this count).
    const fetchCount = () => fetchShopUnreadCount(supabase, user.id, shop?.id).then(setUnreadCount);
    fetchCount();
    const channel = supabase
      .channel(`barber-notifs:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, fetchCount)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, shop?.id]);

  // Recent 5 for the popover — refetched whenever it opens / the count changes.
  useEffect(() => {
    if (!notifOpen || !user) return;
    fetchShopNotifications(supabase, { userId: user.id, shopId: shop?.id, limit: 15 })
      .then(({ data }) => setRecentNotifs((data ?? []) as unknown as typeof recentNotifs));
  }, [notifOpen, user, unreadCount, shop?.id]);

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

  // Desktop (lg+): collapse/expand the docked sidebar, remembered across reloads.
  useEffect(() => {
    try {
      if (localStorage.getItem("cw_sidebar_collapsed") === "1") document.documentElement.classList.add("cw-sidebar-collapsed");
    } catch { /* storage unavailable */ }
  }, []);
  const toggleDesktopSidebar = () => {
    const collapsed = document.documentElement.classList.toggle("cw-sidebar-collapsed");
    try { localStorage.setItem("cw_sidebar_collapsed", collapsed ? "1" : "0"); } catch { /* storage unavailable */ }
  };

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
          // pt/h include env(safe-area-inset-top) so the bar (and its title +
          // bell + avatar) clear the notch / Dynamic Island in the native app
          // and installed PWA — where the webview runs full-screen under it.
          // Solid black (not black/92) so the bar blends with the pure-black
          // page at rest — no faint darker strip — and cleanly covers content
          // when scrolled. Border fades in only once you scroll under it.
          "lg:hidden fixed top-0 left-0 right-0 z-30 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] flex items-center gap-2 pl-5 pr-3 bg-card transition-all duration-200 border-b",
          scrolled ? "border-border" : "border-transparent",
          topBarHidden ? "-translate-y-full" : "translate-y-0",
        )}
      >
        {/* Page title (left) — 23px uppercase, matching the shop portal header. */}
        <h1 className="flex-1 min-w-0 text-[23px] font-extrabold uppercase tracking-[0.02em] text-foreground truncate">{BAR_TITLE[pathname] ?? ""}</h1>
        {/* Notifications bell — same control as the owner mobile header,
            scoped to this barber. Red dot when there's anything unread. */}
        <button
          type="button"
          onClick={() => setNotifOpen(o => !o)}
          aria-label="Notifications"
          aria-expanded={notifOpen}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center text-foreground transition-colors relative flex-shrink-0",
            notifOpen ? "bg-white/10" : "hover:bg-white/5",
          )}
        >
          <Bell size={20} strokeWidth={2.5} />
          <UnreadBadge count={unreadCount} />
        </button>
        {/* Account menu — tap the avatar for a dropdown (profile / payments /
            notifications / log out). Shown on every page, including Profile. */}
        <ProfileMenu
          name={displayName}
          photo={barber?.photo}
          roleLabel={profile?.role === "shop_owner" ? "Owner · Barber" : "Barber"}
          items={barberMenuItems(
            barber?.permissions?.view_earnings === true,
            shop?.slug && barber?.id
              ? () => void shareLink(`${window.location.origin}/book/${shop.slug}?barber=${barber.id}`, `Book with ${barber.name ?? "me"}`)
              : undefined,
          )}
          triggerClassName="w-9 h-9 rounded-full bg-white text-black font-extrabold text-[11px] flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0 overflow-hidden"
        />
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
              className="lg:hidden fixed inset-x-0 bottom-0 sm:inset-0 z-[80] sm:flex sm:items-center sm:justify-center sm:p-4"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "tween", duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              <div
                ref={notifSheetRef}
                className="bg-card border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col w-full sm:max-w-md max-h-[82vh] sm:max-h-[80vh] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-2"
                style={{
                  transform: notifDragY ? `translateY(${notifDragY}px)` : undefined,
                  transition: notifDragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)",
                }}
              >
                <div onClick={() => setNotifOpen(false)} className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing flex-shrink-0">
                  <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
                </div>
                <div className="px-4 pb-3 flex items-center justify-between flex-shrink-0">
                  <p className="text-base font-bold text-foreground">Notifications</p>
                  <Link href="/barber-dashboard/notifications" onClick={() => setNotifOpen(false)} className="text-xs font-semibold text-accent-soft hover:underline">See all</Link>
                </div>
                {recentNotifs.length === 0 ? (
                  <div className="px-4 py-10 text-center text-grey text-sm">Nothing here yet</div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-border">
                    {recentNotifs.map(n => {
                      const { Icon, cls } = notifIcon(n.type);
                      const isWaitlist = n.entity_type === "waitlist" && !!n.entity_id;
                      const body = (
                        <>
                          <span className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", cls)}>
                            <Icon size={16} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className={cn("text-sm truncate", n.is_read ? "font-semibold text-[#cdcdcd]" : "font-bold text-foreground")}>{cleanNotifTitle(n.title)}</p>
                              <span className="text-[11px] text-grey flex-shrink-0">{timeAgo(n.created_at)}</span>
                            </div>
                            <p className="text-xs text-grey line-clamp-2 mt-0.5">{n.message}</p>
                            {isWaitlist && (
                              <span className="inline-flex items-center gap-0.5 mt-1.5 text-[11px] font-semibold text-amber-300">Accept &amp; assign ›</span>
                            )}
                          </div>
                          {!n.is_read && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-1.5" />}
                        </>
                      );
                      const rowCls = cn("flex gap-3 px-4 py-3.5 transition-colors active:bg-white/[0.06] w-full text-left", n.is_read ? "hover:bg-card-raised" : "bg-white/[0.04] hover:bg-white/[0.07]");
                      return isWaitlist ? (
                        <button key={n.id} type="button" onClick={() => openAssign(n.entity_id!)} className={rowCls}>{body}</button>
                      ) : (
                        <Link key={n.id} href="/barber-dashboard/notifications" onClick={() => setNotifOpen(false)} className={rowCls}>{body}</Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {assignReq && (
        <WaitlistAssignSheet
          request={assignReq}
          slotInterval={slotInterval}
          accessToken={accessToken}
          onClose={() => setAssignReq(null)}
          onDone={() => setAssignReq(null)}
        />
      )}

      {mobileOpen && (
        <div
          // Inline background (not a bg-black/* class) so this drawer backdrop
          // doesn't match ModalChrome's selector — the drawer then uses only its
          // own overflow-lock, avoiding ModalChrome's position:fixed body-lock
          // (which broke the drawer's full height on iOS) and its nav-hide (which
          // left a dark void at the bottom when the drawer was open).
          className="lg:hidden fixed inset-0 z-[55] animate-fade-in"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Desktop: floating "show sidebar" button — CSS reveals it only when the
          sidebar is collapsed on lg+ (hidden on mobile / when expanded). */}
      <button
        type="button"
        onClick={toggleDesktopSidebar}
        aria-label="Show sidebar"
        className="cw-sidebar-expand hidden fixed left-3 z-[61] w-9 h-9 rounded-xl bg-card border border-border text-grey hover:text-foreground shadow-sm items-center justify-center"
        style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <PanelLeft size={18} />
      </button>

      <aside
        className={cn(
          "cw-sidebar fixed inset-y-0 left-0 z-[60] w-64 pt-[env(safe-area-inset-top)] flex flex-col bg-surface border-r border-border transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      {/* Sidebar wordmark — clean Sora 800 24px white, centered. */}
      <div
        className="cw-grad cw-logo-fade relative whitespace-nowrap border-b border-border flex items-center justify-start pl-6"
        style={{
          fontFamily: "'Sora', sans-serif",
          fontWeight: 800,
          fontSize: "26px",
          letterSpacing: "-0.02em",
          color: "#ffffff",
          height: "64px",
        }}
      >
        CLIPWISE
        {/* Desktop: collapse the sidebar (mobile uses the drawer + backdrop tap) */}
        <button
          type="button"
          onClick={toggleDesktopSidebar}
          aria-label="Hide sidebar"
          className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-grey hover:text-foreground hover:bg-surface-raised items-center justify-center"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      {/* Reused from the owner sidebar — only renders when shops.length > 1 */}
      <ShopSwitcher shop={shop} shops={shops} setActiveShop={setActiveShop} />

      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-0.5">
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
                  ? "bg-foreground text-background border border-foreground"
                  : "text-grey hover:text-foreground hover:bg-card-raised"
              )}
            >
              <Icon size={18} className={cn(isActive ? "text-background" : "text-grey group-hover:text-foreground")} />
              <span className="flex-1">{item.label}</span>
              {item.badge && unreadCount > 0 && (
                <span className={cn(
                  "text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center",
                  isActive ? "bg-card text-foreground" : "bg-foreground text-background",
                )}>{unreadCount}</span>
              )}
              {isActive && <ChevronRight size={14} className="text-background" />}
            </Link>
          );
        })}

        {/* Owner-also-barber: show a way back to the owner dashboard */}
        {profile?.role === "shop_owner" && (
          <Link href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-grey hover:text-foreground hover:bg-surface-raised mt-3 border-t border-border pt-4">
            <Building2 size={18} className="text-grey group-hover:text-foreground" />
            <span className="flex-1">Owner Dashboard</span>
            <ChevronRight size={14} className="opacity-50" />
          </Link>
        )}
      </nav>

      <div className="px-3 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-white border border-white flex items-center justify-center text-black font-semibold text-sm overflow-hidden">
            <AvatarImage src={barber?.photo} alt={displayName} className="w-full h-full object-cover" fallback={<>{initial}</>} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
            <p className="text-xs text-grey">{profile?.role === "shop_owner" ? "Owner · Barber" : "Barber"}</p>
          </div>
          <PortalThemeToggle className="w-8 h-8 flex-shrink-0" />
          <button onClick={confirmSignOut} className="text-grey hover:text-red-400 transition-colors">
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
