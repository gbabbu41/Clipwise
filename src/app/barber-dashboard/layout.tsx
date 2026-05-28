"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { BarberProvider } from "@/lib/barber-context";
import { BarberSidebar, BarberMobileNav } from "@/components/barber/sidebar";

export default function BarberDashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.push("/login"); return; }
    if (profile && profile.role !== "barber") { router.push("/dashboard"); return; }
  }, [user, profile, loading, router]);

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
    <BarberProvider>
      <div className="min-h-screen bg-background">
        <BarberSidebar />
        <main className="lg:ml-64 pb-20 lg:pb-0">
          {children}
        </main>
        <BarberMobileNav />
      </div>
    </BarberProvider>
  );
}
