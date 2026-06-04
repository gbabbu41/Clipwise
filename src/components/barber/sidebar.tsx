"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Calendar, Clock, Users, DollarSign, User, LogOut, ChevronRight, Scissors, Building2, CalendarOff, Menu } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { ShopSwitcher } from "@/components/dashboard/shop-switcher";
import { DEFAULT_BARBER_PERMISSIONS, type BarberPermissions } from "@/lib/database.types";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  permKey?: keyof BarberPermissions;
};

const navItems: NavItem[] = [
  { href: "/barber-dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/barber-dashboard/schedule", label: "My Schedule", icon: Calendar },
  // Availability stays visible even when edit is disabled — the page itself
  // shows a read-only view with a lock banner.
  { href: "/barber-dashboard/availability", label: "Availability", icon: Clock },
  { href: "/barber-dashboard/time-off", label: "Time Off", icon: CalendarOff, permKey: "request_time_off" },
  { href: "/barber-dashboard/clients", label: "My Clients", icon: Users, permKey: "view_clients" },
  { href: "/barber-dashboard/earnings", label: "Earnings", icon: DollarSign, permKey: "view_earnings" },
  { href: "/barber-dashboard/profile", label: "Profile", icon: User },
];

export function BarberSidebar() {
  const pathname = usePathname();
  const { user, profile, signOut } = useAuth();
  const { barber, shop, shops, setActiveShop } = useBarber();
  const [mobileOpen, setMobileOpen] = useState(false);

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
          "md:hidden fixed top-0 left-0 right-0 z-30 h-14 flex items-center gap-2 pl-5 pr-3 bg-black/92 backdrop-blur-xl transition-all duration-200 border-b",
          scrolled ? "border-[#1e1e1e]" : "border-transparent",
          topBarHidden ? "-translate-y-full" : "translate-y-0",
        )}
      >
        {/* CLIPWISE wordmark — DM Mono medium, uppercase, tracked-out
            watermark style. Page headline stays the visual primary. */}
        <span className="font-mono font-medium uppercase tracking-[0.18em] text-[14px] text-[#888] leading-none flex-shrink-0 select-none">
          ClipWise
        </span>
        <div className="flex-1" />
        <Link
          href="/barber-dashboard/profile"
          aria-label="Account"
          className="w-9 h-9 rounded-full bg-white text-black font-extrabold text-[11px] flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0"
        >
          {initial}
        </Link>
      </div>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-[55] animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-[60] w-64 h-screen flex flex-col bg-surface border-r border-border transition-transform duration-200 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      <button
        type="button"
        onClick={() => setMobileOpen(false)}
        aria-label="Close menu"
        className="md:hidden absolute top-3 right-3 w-9 h-9 rounded-lg flex items-center justify-center text-gold hover:text-white hover:bg-surface-raised transition-colors"
      >
        <Menu size={18} />
      </button>
      <div className="px-3 py-6 border-b border-border flex justify-center">
        <Logo size="md" className="text-white" />
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
  // 4 page-links + 1 'More' drawer-opener. Earnings hides when the perm
  // is off — list shrinks to 3 links + More to keep balance.
  const linkItems = [
    { href: "/barber-dashboard",              label: "Home",     emoji: "🏠", show: true },
    { href: "/barber-dashboard/schedule",     label: "Schedule", emoji: "📅", show: true },
    { href: "/barber-dashboard/availability", label: "Hours",    emoji: "⏰", show: true },
    { href: "/barber-dashboard/earnings",     label: "Earnings", emoji: "💰", show: perms.view_earnings !== false },
  ].filter(i => i.show);
  const toggleDrawer = () => window.dispatchEvent(new Event("cw-toggle-sidebar"));

  return (
    <nav className="cw-bnav md:hidden">
      {linkItems.map((item) => {
        const isActive = pathname === item.href
          || (item.href !== "/barber-dashboard" && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} className={cn("cw-ni", isActive && "active")}>
            <div className="cw-ni-icon">{item.emoji}</div>
            <div className="cw-ni-label">{item.label}</div>
            {isActive && <div className="cw-ni-line" />}
          </Link>
        );
      })}
      {/* 'More' opens the sidebar drawer (Profile, Time Off, etc.). */}
      <button type="button" onClick={toggleDrawer} className="cw-ni" aria-label="Toggle menu">
        <div className="cw-ni-icon">⋯</div>
        <div className="cw-ni-label">More</div>
      </button>
    </nav>
  );
}
