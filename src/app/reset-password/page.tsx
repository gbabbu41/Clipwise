"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { AuthShell } from "@/components/marketing/auth-shell";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  // Gate the form on an actual recovery session — otherwise an already-signed-in
  // user could change their live password just by opening this public page.
  const [recovery, setRecovery] = useState<"checking" | "ready" | "invalid">("checking");

  useEffect(() => {
    let settled = false;
    const markReady = () => { settled = true; setRecovery("ready"); };
    // The recovery token arrives in the URL hash; Supabase fires PASSWORD_RECOVERY
    // when it establishes the recovery session. Either signal means we're good.
    if (typeof window !== "undefined" && /(?:type=recovery|access_token=)/.test(window.location.hash)) markReady();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") markReady();
    });
    // No recovery signal shortly after load → invalid/expired link (or a direct
    // visit by a logged-in user). Don't let them set a password.
    const t = setTimeout(() => { if (!settled) setRecovery("invalid"); }, 2500);
    return () => { clearTimeout(t); subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (recovery !== "ready") { setError("This reset link is invalid or has expired."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (err) { setError("Couldn't update your password — the link may have expired. Request a new one."); return; }
    setDone(true);
    setTimeout(() => router.push("/login"), 3000);
  };

  return (
    <AuthShell title="Set new password" subtitle="Choose a strong password for your account">
      {done ? (
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <div className="logo-fb" style={{ borderRadius: 999, background: "rgba(59,209,161,.14)", borderColor: "rgba(59,209,161,.28)" }}><Check size={22} style={{ color: "var(--ok)" }} /></div>
          <p style={{ fontWeight: 600, color: "var(--t1)" }}>Password updated!</p>
          <p className="lead" style={{ fontSize: 14, textAlign: "center" }}>Redirecting you to sign in…</p>
        </div>
      ) : recovery === "invalid" ? (
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <div className="logo-fb" style={{ borderRadius: 999, background: "rgba(255,90,90,.12)", borderColor: "rgba(255,90,90,.3)" }}><AlertCircle size={22} style={{ color: "#ff8a8a" }} /></div>
          <p style={{ fontWeight: 600, color: "var(--t1)" }}>Invalid or expired link</p>
          <p className="lead" style={{ fontSize: 14, textAlign: "center" }}>This password-reset link is no longer valid. Request a new one.</p>
          <p className="authfoot" style={{ marginTop: 6 }}><Link href="/forgot-password">Send a new reset link</Link></p>
        </div>
      ) : (
        <>
          {error && <div className="err"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="rp-password">New password</label>
              <div className="ip">
                <Lock size={16} className="lic" />
                <input id="rp-password" className="pl pr" type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" required />
                <button type="button" aria-label={showPass ? "Hide password" : "Show password"} onClick={() => setShowPass(!showPass)} className="eye">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="rp-confirm">Confirm password</label>
              <div className="ip">
                <Lock size={16} className="lic" />
                <input id="rp-confirm" className="pl" type={showPass ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your password" required />
              </div>
            </div>
            <button type="submit" className="pill w full" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
          <p className="authfoot"><Link href="/login">Back to sign in</Link></p>
        </>
      )}
    </AuthShell>
  );
}
