"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Calendar, Clock, Users, DollarSign, User, LogOut, ChevronRight, Scissors } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";

const navItems = [
  { href: "/barber-dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/barber-dashboard/schedule", label: "My Schedule", icon: Calendar },
  { href: "/barber-dashboard/availability", label: "Availability", icon: Clock },
  { href: "/barber-dashboard/clients", label: "My Clients", icon: Users },
  { href: "/barber-dashboard/earnings", label: "Earnings", icon: DollarSign },
  { href: "/barber-dashboard/profile", label: "Profile", icon: User },
];

export function BarberSidebar() {
  const pathname = usePathname();
  const { user, profile, signOut } = useAuth();
  const { barber, shop } = useBarber();

  const displayName = barber?.name ?? profile?.name ?? user?.email ?? "Barber";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="hidden md:flex flex-col w-64 min-h-screen bg-surface border-r border-border fixed left-0 top-0 z-40">
      <div className="px-6 py-5 border-b border-border">
        <Logo size="md" />
        <div className="flex items-center gap-1.5 mt-1">
          <Scissors size={11} className="text-gold" />
          <p className="text-xs text-gray-500">{shop?.name ?? "Barber Portal"}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
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
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-semibold text-sm">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-gray-500">Barber</p>
          </div>
          <button onClick={signOut} className="text-gray-500 hover:text-red-400 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function BarberMobileNav() {
  const pathname = usePathname();
  const mobileItems = [
    { href: "/barber-dashboard", label: "Home", icon: LayoutDashboard },
    { href: "/barber-dashboard/schedule", label: "Schedule", icon: Calendar },
    { href: "/barber-dashboard/availability", label: "Hours", icon: Clock },
    { href: "/barber-dashboard/earnings", label: "Earnings", icon: DollarSign },
    { href: "/barber-dashboard/profile", label: "Profile", icon: User },
  ];

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
