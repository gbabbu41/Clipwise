"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, MobileNav } from "@/components/dashboard/sidebar";
import { StripeWarningBanner } from "@/components/dashboard/stripe-warning-banner";
import { useAuth } from "@/lib/auth-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, shop, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.push("/login"); return; }
    if (profile?.role === "barber") { router.push("/barber-dashboard"); return; }
    if (profile?.role === "customer") { router.push("/"); return; }
    if (shop && shop.status !== "approved" && pathname !== "/dashboard/pending") {
      router.push("/dashboard/pending");
    }
  }, [user, profile, shop, loading, router, pathname]);

  if (loading) {
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

  return (
    <div className="min-h-screen bg-black">
      <Sidebar />
      {/* pt-12 reserves space for the mobile top bar in the Sidebar component;
          md:pt-0 removes that gap on desktop where the bar isn't rendered. */}
      {/* pt-14 = exact mobile top-bar height (h-14). No border below the
          bar now, so a gap would look like a stray empty strip. Content
          sits flush against the translucent bar instead. */}
      <main className="md:ml-64 pt-14 md:pt-0 pb-24 md:pb-0">
        <StripeWarningBanner />
        {children}
      </main>
      <MobileNav />
    </div>
  );
}
