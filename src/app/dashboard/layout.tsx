"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, MobileNav } from "@/components/dashboard/sidebar";
import { StripeWarningBanner } from "@/components/dashboard/stripe-warning-banner";
import { AddSelfBarberBanner } from "@/components/dashboard/add-self-barber-banner";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { NotificationListener } from "@/components/notification-listener";
import { ModalChrome } from "@/components/modal-chrome";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { SwipeNavigator } from "@/components/swipe-navigator";
import { PortalThemeProvider } from "@/components/portal-theme";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { INLINE_HEADER_PAGES } from "@/lib/inline-header-pages";

// Order mirrors the mobile bottom nav so a swipe feels like sliding between tabs.
const OWNER_SWIPE_ORDER = [
  "/dashboard",
  "/dashboard/schedule",
  "/dashboard/calendar",
  "/dashboard/pos",
  "/dashboard/payments",
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, shop, loading, refreshShop, accessToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const triedRefresh = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const [stuck, setStuck] = useState(false);
  const initialUidRef = useRef<string | null | undefined>(undefined);

  // A shop owner whose shop hasn't loaded into context yet (e.g. just finished
  // onboarding) would otherwise fall through to the "No shop found" page. Try a
  // single re-fetch before any no-shop UI renders; if it's still null after,
  // it's a genuinely shopless owner and the page shows the setup CTA.
  const ownerShopMissing = !loading && profile?.role === "shop_owner" && !shop;
  const isLoadingState = loading || recovering || (ownerShopMissing && !triedRefresh.current);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.push("/login"); return; }
    if (profile?.role === "barber") { router.push("/barber-dashboard"); return; }
    if (profile?.role === "customer") { router.push("/"); return; }
    if (ownerShopMissing && !triedRefresh.current) {
      triedRefresh.current = true;
      setRecovering(true);
      refreshShop().finally(() => setRecovering(false));
      return;
    }
    if (shop && shop.status !== "approved" && pathname !== "/dashboard/pending") {
      router.push("/dashboard/pending");
    }
  }, [user, profile, shop, loading, router, pathname, ownerShopMissing, refreshShop]);

  // Safety net: never spin forever. If we're still loading after 10s, surface a
  // recover screen (reload / sign in) instead of an endless spinner — covers a
  // dropped connection, a stale token, or a same-browser session collision.
  useEffect(() => {
    if (!isLoadingState) { setStuck(false); return; }
    const t = setTimeout(() => setStuck(true), 10000);
    return () => clearTimeout(t);
  }, [isLoadingState]);

  // Safety net: if the signed-in user changes under this tab (e.g. a second tab
  // logged into a DIFFERENT account — the same browser shares one session), reload
  // so the whole app re-initializes for the current session instead of hanging on
  // stale/mismatched data. A token refresh keeps the same id, so it never fires then.
  useEffect(() => {
    if (loading) return;
    const uid = user?.id ?? null;
    if (initialUidRef.current === undefined) { initialUidRef.current = uid; return; }
    if (initialUidRef.current && uid && initialUidRef.current !== uid) {
      window.location.reload();
    } else {
      initialUidRef.current = uid;
    }
  }, [user, loading]);

  // A solo Starter owner who skipped "add yourself as a barber" is stranded (Staff
  // is hidden on Starter). Instead of silently self-healing (which fired before the
  // token was ready and left no visible trace), we surface a visible one-tap prompt
  // — see <AddSelfBarberBanner /> below.

  // Show the spinner (not the "no shop" page) while we (re)fetch a shop-owner's
  // shop — both on the first render before the effect fires and during the fetch.
  if (isLoadingState) {
    if (stuck) {
      return (
        <div className="min-h-screen bg-card flex items-center justify-center px-4">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-3">⚠️</div>
            <h2 className="text-lg font-bold text-foreground mb-1">Taking longer than usual</h2>
            <p className="text-grey text-sm mb-5">We couldn&apos;t load your dashboard. This can happen if you&apos;re signed in on another tab, or your connection dropped.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl bg-black text-white text-sm font-semibold">Reload</button>
              <button onClick={async () => { await supabase.auth.signOut(); router.push("/login"); }} className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-foreground">Sign in again</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-card flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-border border-t-black rounded-full animate-spin mx-auto mb-3" />
          <p className="text-grey text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Block rendering the owner dashboard for roles being redirected away.
  // Without this, a barber/customer briefly sees owner financials while the
  // useEffect redirect is still pending (the race window).
  if (profile?.role === "barber" || profile?.role === "customer") {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-border border-t-black rounded-full animate-spin mx-auto mb-3" />
          <p className="text-grey text-sm">Redirecting...</p>
        </div>
      </div>
    );
  }

  // Calendar is a full-bleed canvas (its own height + horizontal scroll); every
  // other page is capped + centered so wide monitors don't stretch content
  // edge-to-edge. One shared container = consistent width on PC across pages.
  const isCalendar = pathname === "/dashboard/calendar";
  return (
    <PortalThemeProvider>
    <div className="portal min-h-[100dvh] bg-background">
      <ConfirmProvider>
      <ModalChrome />
      <NotificationListener />
      <Sidebar />
      {/* The top spacer (mobile/tablet) clears the floating bell+profile pill.
          main's background follows the active page so that spacer is the page's
          own color — no separate bar. The calendar pins its own sunken canvas so
          the spacer matches it; everything else uses the calm page background. */}
      <main className={`lg:ml-64 ${INLINE_HEADER_PAGES.includes(pathname) ? "pt-[env(safe-area-inset-top)]" : "pt-[calc(2.75rem+env(safe-area-inset-top))]"} lg:pt-0 ${isCalendar ? "pb-[calc(4.25rem+env(safe-area-inset-bottom))]" : "pb-[calc(6rem+env(safe-area-inset-bottom))]"} lg:pb-0 ${isCalendar ? "bg-surface-sunken h-[100dvh] overflow-hidden" : ""}`}>
        <MaintenanceBanner />
        <TrialBanner />
        <StripeWarningBanner />
        <AddSelfBarberBanner />
        <SwipeNavigator order={OWNER_SWIPE_ORDER}>
          {isCalendar ? children : <div className="mx-auto w-full max-w-6xl">{children}</div>}
        </SwipeNavigator>
      </main>
      <MobileNav />
      </ConfirmProvider>
    </div>
    </PortalThemeProvider>
  );
}
