"use client";
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { supabase } from "@/lib/supabase";
import { BarberProvider, useBarber } from "@/lib/barber-context";
import { BarberSidebar, BarberMobileNav } from "@/components/barber/sidebar";
import { AddAppointmentModal } from "@/components/dashboard/add-appointment-modal";
import { DEFAULT_BARBER_PERMISSIONS } from "@/lib/database.types";
import { BarberNotificationListener } from "@/components/barber/barber-notification-listener";
import { ModalChrome } from "@/components/modal-chrome";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
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

// Mounts the shared add-appointment modal for the barber portal — fixed to the
// logged-in barber (no picker). A barber WITHOUT the manage_appointments
// permission sees a "contact your shop" message instead of the form. Posts to the
// same /api/book/in-person the calendar uses. Lives under BarberProvider.
function BarberAddAppt() {
  const { accessToken } = useAuth();
  const { barber, shop } = useBarber();
  const perms = barber?.permissions ?? DEFAULT_BARBER_PERMISSIONS;
  const lockBarber = useMemo(() => (barber ? { id: barber.id, name: barber.name ?? "You" } : null), [barber]);
  return (
    <AddAppointmentModal
      shop={shop ? { id: shop.id } : null}
      accessToken={accessToken}
      canAdd={perms.manage_appointments !== false}
      lockBarber={lockBarber}
    />
  );
}

function BarberGuard({ children }: { children: React.ReactNode }) {
  const { barber, loading, error } = useBarber();
  const { profile, shop } = useAuth();
  const router = useRouter();

  // Where a shop OWNER goes when they land on the barber portal:
  //  • no barber row → dashboard (nothing here for them) — original behavior.
  //  • free/Starter plan → dashboard (solo = ONE view, no separate barber portal).
  //  • Pro/Premium owner who cuts hair → stays; the full multi-barber portal +
  //    commission system is UNCHANGED for paid plans.
  // The plan check waits for `shop` to load so a paid owner is never wrongly bounced.
  useEffect(() => {
    if (loading || profile?.role !== "shop_owner") return;
    if (error || !barber) { router.replace("/dashboard"); return; }
    if (shop && !isPaidPlan(effectivePlan(shop.subscription_plan, shop.subscription_status))) {
      router.replace("/dashboard");
    }
  }, [loading, profile, shop, error, barber, router]);

  const signOut = async () => { await supabase.auth.signOut(); router.replace("/login"); };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !barber) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">✂️</div>
          <h2 className="text-xl font-bold text-foreground mb-2">Account not linked</h2>
          <p className="text-grey text-sm">Your account isn&apos;t linked to a barbershop yet. Ask your shop owner to add you to the staff.</p>
          {/* Never a dead end — always a way out. */}
          <div className="flex items-center justify-center gap-4 mt-6">
            <Link href="/" className="text-sm text-grey hover:text-foreground underline underline-offset-2">Back to home</Link>
            <button onClick={signOut} className="text-sm text-gold hover:underline">Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (!barber.is_active) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Account suspended</h2>
          <p className="text-grey text-sm">Your account has been deactivated by the shop owner. Please contact them directly.</p>
          <button onClick={signOut} className="text-sm text-gold hover:underline mt-6 inline-block">Sign out</button>
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
        <div className="portal min-h-[100dvh] bg-background">
          <ConfirmProvider>
          <ModalChrome />
          <BarberNotificationListener />
          <BarberSidebar />
          {/* Matches the shop portal: docked sidebar at lg+, drawer + bottom nav
              below lg (so iPad shows the dismissible drawer, not a stuck sidebar).
              pt-14 reserves the mobile top-bar height. The full-bleed calendar
              pins its own sunken canvas, so the top spacer matches it there. */}
          <main className={`cw-main lg:ml-64 pt-[calc(3.5rem+env(safe-area-inset-top))] lg:pt-0 ${isCalendar ? "pb-[calc(4.25rem+env(safe-area-inset-bottom))]" : "pb-24"} lg:pb-0 ${isCalendar ? "bg-background h-[100dvh] overflow-hidden" : ""}`}>
            <BarberSwipe isCalendar={isCalendar}>{children}</BarberSwipe>
          </main>
          <BarberMobileNav />
          {/* Global quick-add "+" — instant modal over any page, fixed to this
              barber (or a "contact your shop" message if they lack permission). */}
          <BarberAddAppt />
          </ConfirmProvider>
        </div>
      </BarberGuard>
    </BarberProvider>
    </PortalThemeProvider>
  );
}
