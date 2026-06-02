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

  // Hide the mobile top bar on scroll down, reveal on scroll up.
  const [topBarHidden, setTopBarHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
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
      {/* Mobile top bar — fixed at top, hides on scroll-down, reveals on
          scroll-up. Replaces the floating hamburger so it doesn't sit
          on top of the page header. */}
      <div
        className={cn(
          "md:hidden fixed top-0 left-0 right-0 z-30 h-12 flex items-center gap-2 px-3 bg-surface/95 backdrop-blur-md border-b border-border transition-transform duration-200",
          topBarHidden ? "-translate-y-full" : "translate-y-0",
        )}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-300 hover:text-white hover:bg-surface-raised transition-colors"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Scissors size={11} className="text-gold flex-shrink-0" />
          <p className="text-sm font-medium text-white truncate">{shop?.name ?? "Barber Portal"}</p>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 w-64 h-screen flex flex-col bg-surface border-r border-border transition-transform duration-200 md:translate-x-0",
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
      <div className="px-6 py-5 border-b border-border">
        <Logo size="md" className="text-white" />
        <div className="flex items-center gap-1.5 mt-1">
          <Scissors size={11} className="text-gold" />
          <p className="text-xs text-gray-500">{shop?.name ?? "Barber Portal"}</p>
        </div>
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
                  ? "bg-gold/15 text-gold border border-gold/20"
                  : "text-gray-400 hover:text-white hover:bg-surface-raised"
              )}
            >
              <Icon size={18} className={cn(isActive ? "text-gold" : "text-gray-500 group-hover:text-white")} />
              <span className="flex-1">{item.label}</span>
              {isActive && <ChevronRight size={14} className="text-gold" />}
            </Link>
          );
        })}

        {/* Owner-also-barber: show a way back to the owner dashboard */}
        {profile?.role === "shop_owner" && (
          <Link href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-gray-400 hover:text-white hover:bg-surface-raised mt-3 border-t border-border pt-4">
            <Building2 size={18} className="text-gray-500 group-hover:text-white" />
            <span className="flex-1">Owner Dashboard</span>
            <ChevronRight size={14} className="opacity-50" />
          </Link>
        )}
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-semibold text-sm">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-gray-500">{profile?.role === "shop_owner" ? "Owner · Barber" : "Barber"}</p>
          </div>
          <button onClick={signOut} className="text-gray-500 hover:text-red-400 transition-colors">
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
  const mobileItems = [
    { href: "/barber-dashboard", label: "Home", icon: LayoutDashboard, show: true },
    { href: "/barber-dashboard/schedule", label: "Schedule", icon: Calendar, show: true },
    { href: "/barber-dashboard/availability", label: "Hours", icon: Clock, show: true },
    { href: "/barber-dashboard/earnings", label: "Earnings", icon: DollarSign, show: perms.view_earnings !== false },
    { href: "/barber-dashboard/profile", label: "Profile", icon: User, show: true },
  ].filter(i => i.show);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border px-2 py-2">
      <div className="flex items-center justify-around">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all",
                isActive ? "text-gold" : "text-gray-500"
              )}
            >
              <Icon size={20} />
              <span className="text-xs">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
