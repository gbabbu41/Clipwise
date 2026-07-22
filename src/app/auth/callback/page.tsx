"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/ui/logo";

// OAuth (Google) return target. Resolves the signed-in user's role and routes
// them to the right place — instead of hard-landing on /dashboard and getting
// bounced (a wrong-shell flash for barbers/customers).
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let done = false;
    const route = async (token: string) => {
      if (done) return;
      done = true;
      const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
      const { profile, shop } = res.ok ? await res.json() : { profile: null, shop: null };
      if (profile?.role === "super_admin") router.replace("/admin");
      else if (profile?.role === "shop_owner") router.replace(shop ? "/dashboard" : "/onboarding/plan");
      else if (profile?.role === "barber") router.replace("/barber-dashboard");
      else router.replace("/");
    };

    // The session may already be in storage, or arrive via the auth event once
    // Supabase finishes processing the OAuth hash.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) route(session.access_token);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) route(session.access_token);
    });
    const t = setTimeout(() => { if (!done) router.replace("/login"); }, 5000);
    return () => { clearTimeout(t); subscription.unsubscribe(); };
  }, [router]);

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
      <Logo size="md" />
      <p className="text-sm text-[#8f8f8f]">Signing you in…</p>
    </div>
  );
}
