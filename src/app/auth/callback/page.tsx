"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/ui/logo";

// OAuth (Google) + email-link (confirmation / magic-link / recovery) return
// target. Resolves the signed-in user's role and routes them to the right place.
// Hardened so it can NEVER strand the user on a silent black screen: it verifies
// email links explicitly, always navigates once a session exists (even if
// /api/profile is slow), and on failure shows a real message with a way out.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let done = false;

    const route = async (token: string) => {
      if (done) return;
      done = true;
      // Honor a `next` deep link when it's internal AND belongs to the resolved
      // role's portal (same guard as /login) — otherwise fall back to the role
      // home. Never sit on the blank "Signing you in…" screen if /api/profile is
      // slow or errors.
      const p = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const raw = p.get("next");
      const internal = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
      const destFor = (prefixes: string[]) =>
        internal && prefixes.some(pf => internal === pf || internal.startsWith(pf + "/")) ? internal : null;
      try {
        const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
        const { profile, shop } = res.ok ? await res.json() : { profile: null, shop: null };
        if (profile?.role === "super_admin") router.replace(destFor(["/admin"]) ?? "/admin");
        else if (profile?.role === "barber") router.replace(destFor(["/barber-dashboard"]) ?? "/barber-dashboard");
        else if (profile?.role === "shop_owner") router.replace(shop ? (destFor(["/dashboard", "/onboarding"]) ?? "/dashboard") : "/onboarding/plan");
        else router.replace(internal ?? "/dashboard"); // logged in; let the dashboard shell resolve role/shop
      } catch {
        router.replace("/dashboard");
      }
    };

    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");

    // The provider / link returned an explicit error (denied, expired, reused) —
    // surface it instead of spinning forever.
    if (params.get("error") || params.get("error_description")) { setFailed(true); return; }

    (async () => {
      // Email confirmation / magic-link / recovery links carry a token_hash that
      // — unlike an OAuth code — is NOT auto-exchanged by the client, so without
      // this the page just hangs. Verify it explicitly.
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "signup" | "magiclink" | "recovery" | "invite" | "email_change" | "email",
        });
        if (error) { setFailed(true); return; }
      }
      // A session may already exist, or arrive once the client finishes exchanging
      // the OAuth code in the URL (detectSessionInUrl).
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) route(session.access_token);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) route(session.access_token);
    });

    // Nothing resolved in time → show a real message with a way out, never a
    // silent black screen.
    const t = setTimeout(() => { if (!done) setFailed(true); }, 8000);
    return () => { clearTimeout(t); subscription.unsubscribe(); };
  }, [router]);

  if (failed) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo size="md" />
        <p className="text-sm text-[#8f8f8f] max-w-xs">We couldn&apos;t finish signing you in. The link may have expired or already been used.</p>
        <Link href="/login" className="text-sm text-gold hover:underline">Back to sign in</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
      <Logo size="md" />
      <p className="text-sm text-[#8f8f8f]">Signing you in…</p>
    </div>
  );
}
