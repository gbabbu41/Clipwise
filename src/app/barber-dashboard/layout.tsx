"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { BarberProvider, useBarber } from "@/lib/barber-context";
import { BarberSidebar, BarberMobileNav } from "@/components/barber/sidebar";
import { NotificationListener } from "@/components/notification-listener";
import { ModalChrome } from "@/components/modal-chrome";
import { SwipeNavigator } from "@/components/swipe-navigator";
import { PortalThemeProvider } from "@/components/portal-theme";

// Order mirrors the barber bottom nav so a swipe slides between tabs.
const BARBER_SWIPE_ORDER = [
  "/barber-dashboard",
  "/barber-dashboard/calendar",
  "/barber-dashboard/schedule",
  "/barber-dashboard/earnings",
];

// Swipe wrapper that drops tabs the owner has turned off for this barber, so a
// swipe never lands on a permission-blocked page (Payments hides when
// view_earnings is off — matching the bottom nav). Rendered under BarberProvider.
function BarberSwipe({ isCalendar, children }: { isCalendar: boolean; children: React.ReactNode }) {
  const { barber } = useBarber();
  const perms = barber?.permissions;
  const order = BARBER_SWIPE_ORDER.filter(h =>
    h !== "/barber-dashboard/earnings" || perms?.view_earnings !== false,
  );
  return (
    <SwipeNavigator order={order}>
      {isCalendar ? children : <div className="mx-auto w-full max-w-6xl">{children}</div>}
    </SwipeNavigator>
  );
}

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
          <h2 className="text-xl font-bold text-foreground mb-2">Account not linked</h2>
          <p className="text-grey text-sm">Your account isn&apos;t linked to a barbershop yet. Ask your shop owner to add you to the staff.</p>
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
          <h2 className="text-xl font-bold text-foreground mb-2">Account suspended</h2>
          <p className="text-grey text-sm">Your account has been deactivated by the shop owner. Please contact them directly.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function BarberDashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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

  // Calendar is full-bleed; all other pages get one capped+centered container
  // so content doesn't stretch edge-to-edge on wide monitors.
  const isCalendar = pathname === "/barber-dashboard/calendar";

  return (
    <PortalThemeProvider>
    <BarberProvider>
      <BarberGuard>
        <div className="portal min-h-screen bg-background">
          <ModalChrome />
          <NotificationListener />
          <BarberSidebar />
          {/* Matches the shop portal: docked sidebar at lg+, drawer + bottom nav
              below lg (so iPad shows the dismissible drawer, not a stuck sidebar).
              pt-14 reserves the mobile top-bar height. The full-bleed calendar
              pins its own sunken canvas, so the top spacer matches it there. */}
          <main className={`lg:ml-64 pt-[calc(3.5rem+env(safe-area-inset-top))] lg:pt-0 pb-24 lg:pb-0 ${isCalendar ? "bg-surface-sunken h-[100dvh] overflow-hidden" : ""}`}>
            <BarberSwipe isCalendar={isCalendar}>{children}</BarberSwipe>
          </main>
          <BarberMobileNav />
        </div>
      </BarberGuard>
    </BarberProvider>
    </PortalThemeProvider>
  );
}
