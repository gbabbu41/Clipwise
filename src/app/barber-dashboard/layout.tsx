"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { BarberProvider, useBarber } from "@/lib/barber-context";
import { BarberSidebar, BarberMobileNav } from "@/components/barber/sidebar";
import { NotificationListener } from "@/components/notification-listener";
import { ModalChrome } from "@/components/modal-chrome";

function BarberGuard({ children }: { children: React.ReactNode }) {
  const { barber, loading, error } = useBarber();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !barber) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">✂️</div>
          <h2 className="text-xl font-bold text-white mb-2">Account not linked</h2>
          <p className="text-[#777] text-sm">Your account isn&apos;t linked to a barbershop yet. Ask your shop owner to add you to the staff.</p>
        </div>
      </div>
    );
  }

  if (!barber.is_active) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Account suspended</h2>
          <p className="text-[#777] text-sm">Your account has been deactivated by the shop owner. Please contact them directly.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function BarberDashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  // Sidebar collapse (docked breakpoint) — persisted across navigations/reloads.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem("cw_sidebar_collapsed") === "1"); }, []);
  const toggleCollapsed = () => setCollapsed(c => {
    const next = !c;
    try { localStorage.setItem("cw_sidebar_collapsed", next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });

  useEffect(() => {
    if (loading) return;
    if (!user) { router.push("/login"); return; }
    // Allow barbers OR shop_owners who also cut hair (have a linked barber row).
    // If they're a customer, no business here.
    if (profile && profile.role === "customer") { router.push("/"); return; }
  }, [user, profile, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <BarberProvider>
      <BarberGuard>
        <div className="min-h-screen bg-background">
          <ModalChrome />
          <NotificationListener />
          <BarberSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
          {/* pt-14 matches the mobile top-bar height — flush, no extra gap.
              Left margin drops to 0 when the sidebar is collapsed. */}
          <main className={`${collapsed ? "md:ml-0" : "md:ml-64"} pt-14 md:pt-0 pb-24 md:pb-0`}>
            {children}
          </main>
          <BarberMobileNav />
        </div>
      </BarberGuard>
    </BarberProvider>
  );
}
