"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Calendar, Users, UserCheck, Receipt,
  BarChart3, Scissors, Star, Bell, CreditCard, Settings,
  Gift, ChevronRight, LogOut, Package, ClipboardList, CalendarDays, Ticket, Banknote, Share2, Megaphone, UmbrellaOff, Tablet, MessageSquare,
  Menu, BellRing, AlertTriangle, CalendarX2, Info, Clock,
} from "lucide-react";
// Logo component no longer used — sidebar wordmark is an inline div now.
import { cn, timeAgo } from "@/lib/utils";

// Notification visual config — one clean type-icon (no raw emoji), tinted chip.
const NOTIF_ICON: Record<string, { Icon: typeof Bell; cls: string }> = {
  booking:      { Icon: Calendar,     cls: "bg-emerald-500/15 text-emerald-400" },
  cancellation: { Icon: CalendarX2,   cls: "bg-rose-500/15 text-rose-400" },
  "no-show":    { Icon: AlertTriangle, cls: "bg-amber-500/15 text-amber-400" },
  review:       { Icon: Star,         cls: "bg-yellow-500/15 text-yellow-400" },
  inventory:    { Icon: Package,      cls: "bg-sky-500/15 text-sky-400" },
  system:       { Icon: Info,         cls: "bg-white/10 text-[#aaa]" },
};
const notifIcon = (type: string) => NOTIF_ICON[type] ?? NOTIF_ICON.system;
// Strip any leading emoji/symbols the stored title carries (e.g. "✅ Paid") so
// the row shows a single, consistent icon instead of two.
const cleanNotifTitle = (t: string) => t.replace(/^[^A-Za-z0-9]+/, "").trim() || t;
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { effectivePlan, planHasFeature, type PlanFeature } from "@/lib/validation";
import { ShopSwitcher } from "@/components/dashboard/shop-switcher";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: boolean;
  ownerOnly?: boolean;
  feature?: PlanFeature;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Grouped sidebar nav. Items that don't pass the ownerOnly + feature-gating
// filter are skipped at render time; a section whose items are all filtered
// out is hidden entirely (along with its label + divider) so barbers and
// gated shops don't see empty group headers.
const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
      { href: "/dashboard/payments", label: "Payments", icon: CreditCard, ownerOnly: true, feature: "payments" },
      { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/dashboard/waitlist", label: "Waitlist", icon: ClipboardList },
      { href: "/dashboard/waitlist-requests", label: "Spot Waitlist", icon: BellRing, ownerOnly: true },
      { href: "/dashboard/kiosk", label: "Walk-in Kiosk", icon: Tablet, ownerOnly: true },
      { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
      { href: "/dashboard/notifications", label: "Notifications", icon: Bell, badge: true },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/dashboard/clients", label: "Clients", icon: Users, ownerOnly: true },
      { href: "/dashboard/staff", label: "Staff", icon: UserCheck, ownerOnly: true },
      { href: "/dashboard/schedule", label: "Schedule", icon: Clock, ownerOnly: true },
      { href: "/dashboard/time-off", label: "Time Off", icon: UmbrellaOff, ownerOnly: true },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/dashboard/services", label: "Services", icon: Scissors, ownerOnly: true },
      { href: "/dashboard/pos", label: "Point of Sale", icon: Receipt, feature: "pos" },
      { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, ownerOnly: true },
      { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone, ownerOnly: true },
      { href: "/dashboard/payroll", label: "Payroll", icon: Banknote, ownerOnly: true, feature: "commission" },
      { href: "/dashboard/inventory", label: "Inventory", icon: Package, ownerOnly: true, feature: "inventory" },
      { href: "/dashboard/loyalty", label: "Loyalty & Promos", icon: Gift, ownerOnly: true, feature: "loyalty" },
      { href: "/dashboard/gift-cards", label: "Gift Cards", icon: Ticket, ownerOnly: true, feature: "loyalty" },
      { href: "/dashboard/reviews", label: "Reviews", icon: Star, ownerOnly: true },
      { href: "/dashboard/share", label: "Share Link", icon: Share2, ownerOnly: true },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/dashboard/settings", label: "Settings", icon: Settings, ownerOnly: true },
      { href: "/dashboard/billing", label: "Billing", icon: CreditCard, ownerOnly: true },
    ],
  },
];


export function Sidebar() {
  const pathname = usePathname();
  const { user, profile, shop, shops, setActiveShop, signOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAlsoBarber, setIsAlsoBarber] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the mobile drawer whenever the route changes (i.e. the user
  // tapped a nav item) so they're not staring at the drawer on the new page.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Escape closes the drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Lock body scroll while the drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = original; };
    }
  }, [mobileOpen]);

  // Allow the mobile bottom-nav 'More' button to control the drawer via
  // custom window events. `cw-toggle-sidebar` flips it; `cw-open-sidebar`
  // forces it open (kept for back-compat). Decouples MobileNav from this
  // component's state.
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

  // Notification quick-view popover (mobile top-bar bell). State + a
  // refresh effect to grab the last 5 notifications when opened.
  const [notifOpen, setNotifOpen] = useState(false);
  const [recentNotifs, setRecentNotifs] = useState<{ id: string; title: string; message: string; type: string; is_read: boolean; created_at: string }[]>([]);
  useEffect(() => {
    if (!notifOpen || !user) return;
    supabase
      .from("notifications")
      .select("id, title, message, type, is_read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setRecentNotifs((data ?? []) as typeof recentNotifs));
  }, [notifOpen, user, unreadCount]);

  // Detect whether this owner is also linked as a barber → show role-switch link
  useEffect(() => {
    if (!user || !shop || profile?.role !== "shop_owner") { setIsAlsoBarber(false); return; }
    supabase.from("barbers").select("id").eq("user_id", user.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => setIsAlsoBarber(!!data));
  }, [user, shop, profile]);

  useEffect(() => {
    if (!user) return;

    // Initial load
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_read", false)
      .then(({ count }) => setUnreadCount(count ?? 0));

    // Real-time updates
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => {
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_read", false)
          .then(({ count }) => setUnreadCount(count ?? 0));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const displayName = profile?.name ?? user?.email ?? "User";
  const initial = displayName.charAt(0).toUpperCase();
  const shopName = shop?.name ?? "Your Shop";

  return (
    <>
      {/* Floating glass control (mobile) — just the bell + avatar, pinned to the
          top-right and always visible. The old full-width bar + "ClipWise"
          wordmark are gone; page content scrolls under the blur. */}
      <div className="lg:hidden fixed z-30 top-[calc(env(safe-area-inset-top)+0.625rem)] sm:top-[calc(env(safe-area-inset-top)+0.875rem)] right-4 sm:right-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setNotifOpen(o => !o)}
          aria-label="Notifications"
          aria-expanded={notifOpen}
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-amber-500 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.35))] transition-colors relative",
            notifOpen ? "bg-black/20" : "hover:bg-black/10",
          )}
        >
          <Bell size={20} strokeWidth={2.5} />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 w-[8px] h-[8px] bg-red-500 rounded-full border border-white" />
          )}
        </button>
        <Link
          href="/dashboard/settings"
          aria-label="Account"
          className="w-7 h-7 rounded-full bg-white text-black font-extrabold text-[10px] flex items-center justify-center shadow-md hover:opacity-90 transition-opacity"
        >
          {initial}
        </Link>
      </div>

      {/* Notification quick-view popover — slides down under the top bar
          when the bell is on. Tap outside (or the bell again) to close. */}
      {notifOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-[70]" onClick={() => setNotifOpen(false)} />
          <div className="lg:hidden fixed top-[calc(3.5rem+env(safe-area-inset-top))] right-3 left-3 z-[80] max-h-[calc(100dvh-3.5rem-5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl shadow-2xl animate-fade-in">
            <div className="px-4 py-3 border-b border-[#1e1e1e] flex items-center justify-between">
              <p className="text-sm font-bold text-white">Notifications</p>
              <Link href="/dashboard/notifications" onClick={() => setNotifOpen(false)} className="text-xs text-amber-400 hover:underline">See all</Link>
            </div>
            {recentNotifs.length === 0 ? (
              <div className="px-4 py-6 text-center text-[#777] text-sm">Nothing here yet</div>
            ) : (
              <div className="divide-y divide-[#1e1e1e]">
                {recentNotifs.map(n => {
                  const { Icon, cls } = notifIcon(n.type);
                  return (
                    <Link key={n.id} href="/dashboard/notifications" onClick={() => setNotifOpen(false)}
                      className={cn("flex gap-3 px-4 py-3 transition-colors", n.is_read ? "hover:bg-[#141414]" : "bg-white/[0.035] hover:bg-white/[0.06]")}>
                      <span className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", cls)}>
                        <Icon size={15} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={cn("text-sm truncate", n.is_read ? "font-medium text-[#9a9a9a]" : "font-semibold text-white")}>{cleanNotifTitle(n.title)}</p>
                          <span className="text-[11px] text-[#666] flex-shrink-0">{timeAgo(n.created_at)}</span>
                        </div>
                        <p className="text-xs text-[#777] line-clamp-2 mt-0.5">{n.message}</p>
                      </div>
                      {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-1.5" />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Backdrop — only renders on mobile when drawer is open */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-[55] animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          // Light sidebar: pure-white surface with a hairline gray right edge.
          // Looks like the rest of the dashboard cards — Apple-style "this is
          // navigation, not chrome" treatment.
          "fixed left-0 top-0 z-[60] w-64 h-screen flex flex-col bg-[#0c0c0c] border-r border-[#1e1e1e] transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      {/* Sidebar wordmark — clean Sora 800 24px white, left-aligned,
          single line, exact spec from design. */}
      <div
        className="cw-logo-fade whitespace-nowrap border-b border-[#1e1e1e]"
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

      <ShopSwitcher shop={shop} shops={shops} setActiveShop={setActiveShop} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {(() => {
          const plan = effectivePlan(shop?.subscription_plan, shop?.subscription_status);
          const visibleSections = navSections
            .map(section => ({
              ...section,
              items: section.items.filter(item => {
                if (item.ownerOnly && profile?.role === "barber") return false;
                if (item.feature) return planHasFeature(plan, item.feature);
                return true;
              }),
            }))
            .filter(section => section.items.length > 0);

          return visibleSections.map((section, sectionIdx) => (
            <div
              key={section.label}
              className={cn(sectionIdx > 0 && "mt-4 pt-4 border-t border-[#1e1e1e]")}
            >
              <p className="text-[10px] uppercase tracking-wider text-[#777] font-semibold px-3 mb-1.5">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
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
                          "text-[10px] font-bold rounded-full w-[18px] h-[18px] flex items-center justify-center",
                          isActive ? "bg-black text-white" : "bg-white text-black"
                        )}>
                          {unreadCount}
                        </span>
                      )}
                      {isActive && <ChevronRight size={14} className="text-black" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ));
        })()}

        {/* Owner-also-barber: prominent switch to barber view */}
        {isAlsoBarber && (
          <Link href="/barber-dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-[#777] hover:text-white hover:bg-[#141414] mt-4 pt-4 border-t border-[#1e1e1e]">
            <Scissors size={18} className="text-[#777] group-hover:text-white" />
            <span className="flex-1">My Barber View</span>
            <ChevronRight size={14} className="opacity-50" />
          </Link>
        )}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-[#1e1e1e]">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-white font-semibold text-sm">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-[#777] truncate capitalize">{profile?.role ?? "owner"}</p>
          </div>
          <button onClick={signOut} className="text-[#777] hover:text-red-500 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  // 4 page-links + 1 'More' drawer-opener. The drawer is the canonical
  // way to reach everything else (Staff, Services, Settings, etc.).
  const linkItems = [
    { href: "/dashboard",              label: "Home",         icon: LayoutDashboard },
    { href: "/dashboard/appointments", label: "Appointments", icon: ClipboardList },
    { href: "/dashboard/calendar",     label: "Calendar",     icon: CalendarDays },
    { href: "/dashboard/pos",          label: "POS",          icon: CreditCard },
    { href: "/dashboard/payments",     label: "Payments",     icon: Banknote },
  ];
  const toggleDrawer = () => window.dispatchEvent(new Event("cw-toggle-sidebar"));

  return (
    <nav className="cw-bnav lg:hidden">
      {linkItems.map((item) => {
        const isActive = pathname === item.href
          || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} className={cn("cw-ni", isActive && "active")}>
            <div className="cw-ni-icon"><item.icon size={20} /></div>
            <div className="cw-ni-label">{item.label}</div>
            {isActive && <div className="cw-ni-line" />}
          </Link>
        );
      })}
      {/* 'More' opens the sidebar drawer instead of navigating somewhere.
          Replaces the old top-bar hamburger so all chrome lives in one
          predictable spot at the bottom of the screen. */}
      <button type="button" onClick={toggleDrawer} className="cw-ni" aria-label="Toggle menu">
        <div className="cw-ni-icon"><Menu size={20} /></div>
        <div className="cw-ni-label">More</div>
      </button>
    </nav>
  );
}
