"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { ConfirmProvider, useConfirm } from "@/components/ui/confirm-dialog";
import { LayoutDashboard, Store, Users, Settings, Shield, ChevronRight, LogOut, History, AlertTriangle, Ticket } from "lucide-react";

const NAV = [
  { label: "Platform Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Shops", href: "/admin/shops", icon: Store },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Coupons", href: "/admin/coupons", icon: Ticket },
  { label: "Activity", href: "/admin/activity", icon: History },
  { label: "Errors", href: "/admin/errors", icon: AlertTriangle },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

// Rendered INSIDE <ConfirmProvider> (below), so it can use the in-app confirm
// dialog before signing out — a stray click shouldn't drop the admin to /login.
function AdminSignOutButton({ onSignOut }: { onSignOut: () => void }) {
  const { confirm } = useConfirm();
  return (
    <button
      onClick={async () => { if (await confirm({ title: "Sign out?", message: "You'll need to sign in again to get back in.", confirmText: "Sign out", cancelText: "Stay signed in" })) onSignOut(); }}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[#8f8f8f] hover:text-red-400 hover:bg-surface-raised transition-colors"
    >
      <LogOut size={15} /> Sign Out
    </button>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile, loading, signOut } = useAuth();

  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPage || loading) return;
    if (!user || profile?.role !== "super_admin") {
      router.push("/admin/login");
    }
  }, [isLoginPage, loading, user, profile, router]);

  const handleLogout = async () => {
    await signOut();
    router.push("/admin/login");
  };

  if (isLoginPage) return <>{children}</>;

  if (loading || !user || profile?.role !== "super_admin") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ConfirmProvider>
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 bg-surface border-r border-border flex flex-col transition-transform duration-300",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gold rounded-xl flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm">ClipWise Admin</p>
              <p className="text-xs text-[#8f8f8f]">Super Admin Panel</p>
            </div>
          </div>
        </div>

        <div className="mx-4 mt-4 p-3 bg-gold/10 border border-gold/20 rounded-xl">
          <p className="text-xs text-gold font-semibold flex items-center gap-1.5">
            <Shield size={12} /> Logged in as CEO
          </p>
          <p className="text-xs text-[#8f8f8f] mt-0.5 truncate">{user.email}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 mt-2">
          {NAV.map(({ label, href, icon: Icon }) => {
            const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
            return (
              <Link key={href} href={href} onClick={() => setSidebarOpen(false)}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                  active ? "bg-gold/15 text-gold border border-gold/20" : "text-[#8f8f8f] hover:text-white hover:bg-surface-raised"
                )}>
                  <Icon size={16} />
                  {label}
                  {active && <ChevronRight size={14} className="ml-auto" />}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border space-y-1">
          <Link href="/dashboard">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[#8f8f8f] hover:text-white hover:bg-surface-raised transition-colors">
              <LayoutDashboard size={15} /> Shop Dashboard
            </div>
          </Link>
          <AdminSignOutButton onSignOut={handleLogout} />
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="fixed top-0 left-0 right-0 h-14 bg-surface border-b border-border z-20 flex items-center px-4 lg:hidden">
        <button onClick={() => setSidebarOpen(true)} className="text-[#8f8f8f] hover:text-white mr-3">
          <div className="space-y-1">
            <span className="block w-5 h-0.5 bg-current" />
            <span className="block w-5 h-0.5 bg-current" />
            <span className="block w-5 h-0.5 bg-current" />
          </div>
        </button>
        <p className="text-white font-semibold text-sm">ClipWise Admin</p>
        <div className="ml-auto">
          <span className="text-xs text-gold font-medium flex items-center gap-1"><Shield size={11} /> CEO</span>
        </div>
      </div>

      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 min-h-screen">
        {children}
      </main>
    </div>
    </ConfirmProvider>
  );
}
