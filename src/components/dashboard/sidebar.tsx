"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Calendar, Users, UserCheck, Receipt,
  BarChart3, Scissors, Star, Bell, CreditCard, Settings,
  Gift, ChevronRight, LogOut, Package, ClipboardList, CalendarDays, Ticket, Banknote, Share2, Megaphone, UmbrellaOff, Tablet, MessageSquare,
  Menu,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
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
      { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/dashboard/waitlist", label: "Waitlist", icon: ClipboardList },
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
      { href: "/dashboard/stripe-setup", label: "Stripe Setup", icon: CreditCard, ownerOnly: true },
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

  // Allow the mobile bottom-nav 'More' button to open the drawer via a
  // custom window event. Decouples MobileNav (rendered separately by the
  // dashboard layout) from this component's state.
  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("cw-open-sidebar", open);
    return () => window.removeEventListener("cw-open-sidebar", open);
  }, []);

  // Hide the mobile top bar when scrolling down, reveal when scrolling up.
  // Also track whether the page has scrolled at all — used to fade in the
  // hairline below the bar (iOS-style "chrome edge appears once content
  // slides under it"), so at scroll-top the bar dissolves into the page.
  const [topBarHidden, setTopBarHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 4);
      const delta = y - lastY;
      if (Math.abs(delta) < 6) return; // ignore micro-scrolls / rubber-banding
      if (delta > 0 && y > 40) setTopBarHidden(true);
      else if (delta < 0) setTopBarHidden(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
      {/* Mobile top bar — v2 design header pattern: hamburger on the left,
          ClipWise wordmark center-left, bell + circular avatar on the right.
          Bell shows a notif dot when unreadCount > 0; avatar links to the
          settings/account page. Slides off on scroll-down, slides back on
          scroll-up. */}
      <div
        className={cn(
          "md:hidden fixed top-0 left-0 right-0 z-30 h-14 flex items-center gap-2 px-3 bg-black/92 backdrop-blur-xl transition-all duration-200 border-b",
          // Border invisible at scroll-top, fades to a hairline once
          // content starts scrolling under the bar.
          scrolled ? "border-[#1e1e1e]" : "border-transparent",
          topBarHidden ? "-translate-y-full" : "translate-y-0",
        )}
      >
        {/* CLIPWISE wordmark — dimmed grey (#444) so the page headline
            below it has clear hierarchy precedence. Reads as a watermark,
            not as a competing title. */}
        <Logo size="sm" className="text-[#444] flex-shrink-0" />
        <div className="flex-1" />
        <Link
          href="/dashboard/notifications"
          aria-label="Notifications"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-[#0c0c0c] border border-[#1e1e1e] text-amber-400 hover:border-amber-400 transition-colors flex-shrink-0 relative"
        >
          <Bell size={15} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-[7px] h-[7px] bg-white rounded-full border-2 border-black" />
          )}
        </Link>
        <Link
          href="/dashboard/settings"
          aria-label="Account"
          className="w-9 h-9 rounded-full bg-white text-black font-extrabold text-[11px] flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0"
        >
          {initial}
        </Link>
      </div>

      {/* Backdrop — only renders on mobile when drawer is open */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          // Light sidebar: pure-white surface with a hairline gray right edge.
          // Looks like the rest of the dashboard cards — Apple-style "this is
          // navigation, not chrome" treatment.
          "fixed left-0 top-0 z-50 w-64 h-screen flex flex-col bg-[#0c0c0c] border-r border-[#1e1e1e] transition-transform duration-200 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      {/* Mobile-only close button inside the drawer */}
      <button
        type="button"
        onClick={() => setMobileOpen(false)}
        aria-label="Close menu"
        className="md:hidden absolute top-3 right-3 w-9 h-9 rounded-lg flex items-center justify-center text-[#777] hover:text-white hover:bg-[#141414] transition-colors"
      >
        <Menu size={18} />
      </button>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-[#1e1e1e]">
        <Logo size="md" />
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
    { href: "/dashboard",              label: "Home",     emoji: "🏠" },
    { href: "/dashboard/appointments", label: "Schedule", emoji: "📅" },
    { href: "/dashboard/pos",          label: "POS",      emoji: "💳" },
    { href: "/dashboard/clients",      label: "Clients",  emoji: "👥" },
  ];
  const openDrawer = () => window.dispatchEvent(new Event("cw-open-sidebar"));

  return (
    <nav className="cw-bnav md:hidden">
      {linkItems.map((item) => {
        const isActive = pathname === item.href
          || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} className={cn("cw-ni", isActive && "active")}>
            <div className="cw-ni-icon">{item.emoji}</div>
            <div className="cw-ni-label">{item.label}</div>
            {isActive && <div className="cw-ni-line" />}
          </Link>
        );
      })}
      {/* 'More' opens the sidebar drawer instead of navigating somewhere.
          Replaces the old top-bar hamburger so all chrome lives in one
          predictable spot at the bottom of the screen. */}
      <button type="button" onClick={openDrawer} className="cw-ni" aria-label="Open menu">
        <div className="cw-ni-icon">⋯</div>
        <div className="cw-ni-label">More</div>
      </button>
    </nav>
  );
}
