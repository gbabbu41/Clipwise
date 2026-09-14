"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * `native` is resolved on the server from the request User-Agent (see page.tsx)
 * so the "Sign up" line is never even sent to the native app — no flash, no DOM
 * node. Apple requires accounts/subscriptions to be created on the website, so
 * the app's login screen is login-only (email + password + forgot password).
 *
 * Themed for the public site (see AuthShell): the outer chrome (wordmark, title,
 * card) is provided by AuthShell; this component renders the card contents.
 */
export default function LoginForm({ native = false }: { native?: boolean }) {
  const router = useRouter();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "" });

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
        // ONLY an internal relative path (single leading "/", no "//") — guards
        // against open redirects — AND only when that path belongs to THIS
        // user's own portal, so a link meant for one role can't drop another
        // role onto a page that traps them (e.g. an owner on /barber-dashboard).
        const raw = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("redirect")
          : null;
        const internal = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
        const destFor = (prefixes: string[]) =>
          internal && prefixes.some(p => internal === p || internal.startsWith(p + "/")) ? internal : null;

        if (profile?.role === "super_admin") {
          router.push(destFor(["/admin"]) ?? "/admin");
        } else if (profile?.role === "shop_owner") {
          // An owner without a shop must finish onboarding first — ignore the deep link.
          // In the native app there is no in-app plan picker (Apple IAP), so send
          // them to the dashboard rather than /onboarding/plan (which redirects anyway).
          router.push(shop ? (destFor(["/dashboard", "/onboarding"]) ?? "/dashboard") : (native ? "/dashboard" : "/onboarding/plan"));
        } else if (profile?.role === "barber") {
          router.push(destFor(["/barber-dashboard"]) ?? "/barber-dashboard");
        } else {
          router.push(internal ?? "/");
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

  return (
    <>
      {error && (
        <div className="err"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>
      )}

      <form onSubmit={handleLogin}>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <div className="ip">
            <Mail size={16} className="lic" />
            <input
              id="login-email"
              className="pl"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@freshcutz.ca"
              required
            />
          </div>
        </div>

        <div className="field">
          <div className="authrow">
            <label htmlFor="login-password">Password</label>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
          <div className="ip">
            <Lock size={16} className="lic" />
            <input
              id="login-password"
              className="pl pr"
              type={showPass ? "text" : "password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              required
            />
            <button type="button" aria-label={showPass ? "Hide password" : "Show password"} onClick={() => setShowPass(!showPass)} className="eye">
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button type="submit" className="pill w full" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Website-only sign-up. Never rendered in the native app (Apple IAP):
          accounts + subscriptions are created on clipwise.ca. `native` is
          resolved server-side so this line isn't in the app's HTML at all. */}
      {!native && (
        <p className="authfoot">
          Don&rsquo;t have an account? <Link href="/signup">Sign up free</Link>
        </p>
      )}
    </>
  );
}
