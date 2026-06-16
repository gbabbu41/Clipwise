"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, MobileNav } from "@/components/dashboard/sidebar";
import { StripeWarningBanner } from "@/components/dashboard/stripe-warning-banner";
import { NotificationListener } from "@/components/notification-listener";
import { useAuth } from "@/lib/auth-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, shop, loading, refreshShop } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const triedRefresh = useRef(false);
  const [recovering, setRecovering] = useState(false);

  // A shop owner whose shop hasn't loaded into context yet (e.g. just finished
  // onboarding) would otherwise fall through to the "No shop found" page. Try a
  // single re-fetch before any no-shop UI renders; if it's still null after,
  // it's a genuinely shopless owner and the page shows the setup CTA.
  const ownerShopMissing = !loading && profile?.role === "shop_owner" && !shop;

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

  // Show the spinner (not the "no shop" page) while we (re)fetch a shop-owner's
  // shop — both on the first render before the effect fires and during the fetch.
  if (loading || recovering || (ownerShopMissing && !triedRefresh.current)) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1e1e1e] border-t-black rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#777] text-sm">Loading...</p>
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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1e1e1e] border-t-black rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#777] text-sm">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <NotificationListener />
      <Sidebar />
      {/* pt-12 reserves space for the mobile top bar in the Sidebar component;
          md:pt-0 removes that gap on desktop where the bar isn't rendered. */}
      {/* pt-14 = exact mobile top-bar height (h-14). No border below the
          bar now, so a gap would look like a stray empty strip. Content
          sits flush against the translucent bar instead. */}
      <main className="md:ml-64 pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-0 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
        <StripeWarningBanner />
        {children}
      </main>
      <MobileNav />
    </div>
  );
}
