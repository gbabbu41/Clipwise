"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/"><Logo size="md" className="justify-center mb-4" /></Link>
          <h1 className="text-2xl font-bold text-white">Set new password</h1>
          <p className="text-[#8f8f8f] text-sm mt-1">Choose a strong password for your account</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          {done ? (
            <div className="text-center py-4 space-y-3">
              <div className="w-14 h-14 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto">
                <Check size={24} className="text-emerald-400" />
              </div>
              <p className="text-white font-semibold">Password updated!</p>
              <p className="text-[#8f8f8f] text-sm">Redirecting you to sign in…</p>
            </div>
          ) : recovery === "invalid" ? (
            <div className="text-center py-4 space-y-3">
              <div className="w-14 h-14 bg-red-500/15 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle size={24} className="text-red-400" />
              </div>
              <p className="text-white font-semibold">Invalid or expired link</p>
              <p className="text-[#8f8f8f] text-sm">This password-reset link is no longer valid. Request a new one.</p>
              <Link href="/forgot-password" className="inline-block text-gold hover:underline text-sm">Send a new reset link</Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">New Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      required
                      className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8f8f8f] hover:text-white">
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">Confirm Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Repeat your password"
                      required
                      className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  {loading ? "Updating…" : "Update Password"}
                </Button>
              </form>
              <p className="text-center text-sm text-[#8f8f8f] mt-6">
                <Link href="/login" className="text-gold hover:underline">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
