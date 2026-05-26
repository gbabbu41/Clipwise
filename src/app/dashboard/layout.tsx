"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, MobileNav } from "@/components/dashboard/sidebar";
import { useAuth } from "@/lib/auth-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, shop, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.push("/login"); return; }
    // Customers don't have a shop dashboard — send them home
    if (profile?.role === "customer") { router.push("/"); return; }
    // If shop exists but not approved and we're not already on /pending
    if (shop && shop.status !== "approved" && pathname !== "/dashboard/pending") {
      router.push("/dashboard/pending");
    }
  }, [user, profile, shop, loading, router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="lg:ml-64 pb-20 lg:pb-0">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}
