"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Calendar, Users, UserCheck, Receipt,
  BarChart3, Scissors, Star, Bell, CreditCard, Settings,
  Gift, ChevronRight, LogOut, Package, ClipboardList, CalendarDays, Ticket, Banknote, Share2, Megaphone, UmbrellaOff, Tablet, MessageSquare,
  ChevronsUpDown, Check, Building2,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import type { Shop } from "@/lib/database.types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: boolean;
  ownerOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/clients", label: "Clients", icon: Users, ownerOnly: true },
  { href: "/dashboard/staff", label: "Staff", icon: UserCheck, ownerOnly: true },
  { href: "/dashboard/time-off", label: "Time Off", icon: UmbrellaOff, ownerOnly: true },
  { href: "/dashboard/pos", label: "Point of Sale", icon: Receipt },
  { href: "/dashboard/waitlist", label: "Waitlist", icon: ClipboardList },
  { href: "/dashboard/kiosk", label: "Walk-in Kiosk", icon: Tablet, ownerOnly: true },
  { href: "/dashboard/inventory", label: "Inventory", icon: Package, ownerOnly: true },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, ownerOnly: true },
  { href: "/dashboard/payroll", label: "Payroll", icon: Banknote, ownerOnly: true },
  { href: "/dashboard/services", label: "Services", icon: Scissors, ownerOnly: true },
  { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone, ownerOnly: true },
  { href: "/dashboard/loyalty", label: "Loyalty & Promos", icon: Gift, ownerOnly: true },
  { href: "/dashboard/gift-cards", label: "Gift Cards", icon: Ticket, ownerOnly: true },
  { href: "/dashboard/reviews", label: "Reviews", icon: Star, ownerOnly: true },
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
  { href: "/dashboard/notifications", label: "Notifications", icon: Bell, badge: true },
  { href: "/dashboard/share", label: "Share Link", icon: Share2, ownerOnly: true },
  { href: "/dashboard/stripe-setup", label: "Stripe Setup", icon: CreditCard, ownerOnly: true },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

function ShopSwitcher({ shop, shops, setActiveShop }: { shop: Shop | null; shops: Shop[]; setActiveShop: (s: Shop) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (shops.length < 2) return null;

  return (
    <div ref={ref} className="relative px-3 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised border border-border hover:border-gold/40 transition-colors text-left"
      >
        <Building2 size={14} className="text-gold flex-shrink-0" />
        <span className="flex-1 text-sm text-white truncate">{shop?.name ?? "Select Shop"}</span>
        <ChevronsUpDown size={14} className="text-gray-500 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
          {shops.map(s => (
            <button
              key={s.id}
              onClick={() => { setActiveShop(s); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-raised transition-colors text-left"
            >
              <Check size={13} className={cn("flex-shrink-0", s.id === shop?.id ? "text-gold" : "text-transparent")} />
              <span className={cn("truncate", s.id === shop?.id ? "text-white font-medium" : "text-gray-400")}>{s.name}</span>
              {s.status === "pending" && <span className="ml-auto text-xs text-yellow-400">Pending</span>}
              {s.status === "suspended" && <span className="ml-auto text-xs text-red-400">Suspended</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { user, profile, shop, shops, setActiveShop, signOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

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
    <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-surface border-r border-border fixed left-0 top-0 z-40">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-border">
        <Logo size="md" />
        <p className="text-xs text-gray-500 mt-1">{shopName}</p>
      </div>

      <ShopSwitcher shop={shop} shops={shops} setActiveShop={setActiveShop} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {navItems.filter(item => !item.ownerOnly || profile?.role !== "barber").map((item) => {
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
              {item.badge && unreadCount > 0 && (
                <span className="bg-gold text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
              {isActive && <ChevronRight size={14} className="text-gold" />}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-semibold text-sm">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-gray-500 truncate capitalize">{profile?.role ?? "owner"}</p>
          </div>
          <button onClick={signOut} className="text-gray-500 hover:text-red-400 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const mobileItems = [
    { href: "/dashboard", label: "Home", icon: LayoutDashboard },
    { href: "/dashboard/appointments", label: "Bookings", icon: Calendar },
    { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/dashboard/waitlist", label: "Waitlist", icon: ClipboardList },
    { href: "/dashboard/pos", label: "POS", icon: Receipt },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border px-2 py-2 safe-area-bottom">
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
