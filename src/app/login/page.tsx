"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "" });

  // Hidden until Google OAuth routes new sign-ups to the right portal (owner vs
  // customer). Flip to true to restore the button + divider in one line.
  const GOOGLE_ENABLED = false;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const timeout = setTimeout(() => {
      setError("Connection timeout — please try again.");
      setLoading(false);
    }, 8000);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });

      clearTimeout(timeout);

      if (authError) {
        // Generic message so the form can't be used to enumerate which emails
        // are registered (Supabase otherwise distinguishes bad-password from
        // unconfirmed etc.). Keep the confirm hint — it's a real UX need.
        const m = authError.message.toLowerCase();
        setError(m.includes("confirm")
          ? "Please confirm your email first — check your inbox for the link."
          : "Incorrect email or password.");
        setLoading(false);
        return;
      }

      if (data.user && data.session?.access_token) {
        const res = await fetch("/api/profile", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        const { profile, shop } = res.ok ? await res.json() : { profile: null, shop: null };

        // Where were they headed before login bounced them here? Honor it, but
        // ONLY an internal relative path (starts with a single "/") so this
        // can't be abused as an open redirect to an external site.
        const raw = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("redirect")
          : null;
        const dest = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;

        if (profile?.role === "super_admin") {
          router.push(dest ?? "/admin");
        } else if (profile?.role === "shop_owner") {
          // An owner without a shop must finish onboarding first — ignore the deep link.
          router.push(shop ? (dest ?? "/dashboard") : "/onboarding/plan");
        } else if (profile?.role === "barber") {
          router.push(dest ?? "/barber-dashboard");
        } else {
          router.push(dest ?? "/");
        }
      } else {
        // No session came back (edge case) — don't leave the button spinning.
        setError("Couldn't sign you in. Please try again.");
        setLoading(false);
      }
    } catch {
      clearTimeout(timeout);
      setError("Something went wrong — please try again.");
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setGoogleLoading(true);
    // Surface failures instead of silently doing nothing — the usual cause of
    // "Google does nothing" is the provider not being enabled in Supabase.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Land on the role-aware router, not a hard-coded /dashboard.
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      // On success the browser redirects away, so we only reset on failure.
      setGoogleLoading(false);
      setError(/not enabled|provider/i.test(oauthError.message)
        ? "Google sign-in isn't set up yet — please use email & password for now."
        : "Couldn't start Google sign-in. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/"><Logo size="md" className="justify-center mb-4" /></Link>
          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="text-[#8f8f8f] text-sm mt-1">Sign in to your ClipWise account</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          {GOOGLE_ENABLED && (
            <>
              <button
                onClick={handleGoogleLogin}
                disabled={googleLoading}
                className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-border rounded-xl text-sm text-white hover:bg-surface-raised transition-colors mb-6 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {googleLoading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {googleLoading ? "Connecting…" : "Continue with Google"}
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-[#8f8f8f]">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-sm font-medium text-gray-300">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                <input
                  id="login-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@freshcutz.ca"
                  required
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-sm font-medium text-gray-300">Password</label>
                <Link href="/forgot-password" className="text-xs text-gold hover:underline">Forgot password?</Link>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                <input
                  id="login-password"
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  required
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                />
                <button type="button" aria-label={showPass ? "Hide password" : "Show password"} onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8f8f8f] hover:text-white">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <p className="text-center text-sm text-[#8f8f8f] mt-6">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-gold hover:underline font-medium">Sign up free</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
