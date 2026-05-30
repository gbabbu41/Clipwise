"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { getPasswordStrength } from "@/lib/validation";
import { cn } from "@/lib/utils";

type Status = "loading" | "linking" | "password" | "saving-password" | "verify-password" | "verifying-password" | "done" | "error";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [linkType, setLinkType] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState("");

  useEffect(() => {
    async function handle() {
      // 1. Hash-error check first (expired, access_denied, etc.)
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const urlError = hashParams.get("error_code") || hashParams.get("error");
      if (urlError) {
        if (urlError.includes("expired") || urlError === "otp_expired") {
          setError("This invite link has expired. Invite links are only valid for a short time — ask your shop owner to resend you a fresh one from their Staff page.");
        } else if (urlError === "access_denied") {
          setError(`The invite link could not be used (${hashParams.get("error_description") ?? "access denied"}). Ask your shop owner to resend the invite.`);
        } else {
          setError(`Invite link error: ${hashParams.get("error_description") ?? urlError}`);
        }
        setStatus("error");
        return;
      }

      // 2. Capture the link type (invite | magiclink) BEFORE we consume tokens
      const tokenType = hashParams.get("type") ?? "";
      setLinkType(tokenType);

      // 3. Force-use the URL tokens so a stale owner session can't take over
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");
      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token }).catch(() => null);
      }

      // 4. Read the active session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("This invite link is invalid or has already been used. Ask your shop owner for a new one.");
        setStatus("error");
        return;
      }
      setUserEmail(session.user.email ?? "");

      setStatus("linking");

      // 5. Link this auth user to the barber row
      const barberId = session.user.user_metadata?.invite_barber_id as string | undefined;
      const res = await fetch("/api/barber/accept-invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ barber_id: barberId }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Something went wrong. Please contact your shop owner.");
        setStatus("error");
        return;
      }

      // 6. Branch:
      //    - invite link (brand new auth user) → password setup screen
      //    - magic link (existing user) → password verify screen so they sign
      //      in normally and the password gets reinforced; 'forgot password'
      //      escape hatch is provided.
      if (tokenType === "invite") {
        setStatus("password");
      } else {
        setStatus("verify-password");
      }
    }

    handle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function finalize() {
    setStatus("done");
    // Hard nav so the auth context re-fetches the profile with the new role
    setTimeout(() => { window.location.href = "/barber-dashboard"; }, 1400);
  }

  const pwStrength = getPasswordStrength(password);

  async function verifyPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    if (!password) { setPwError("Enter your password"); return; }
    setStatus("verifying-password");
    const { error } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    if (error) {
      setPwError("That password didn't match. Try again, or use 'Forgot password' below.");
      setStatus("verify-password");
      return;
    }
    finalize();
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    if (pwStrength.issues.length > 0) { setPwError(pwStrength.issues.join(" · ")); return; }
    if (password !== confirmPw) { setPwError("Passwords don't match"); return; }
    setStatus("saving-password");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPwError(error.message);
      setStatus("password");
      return;
    }
    finalize();
  }

  // ── Existing-account password verification screen ───────────────────────────
  if (status === "verify-password" || status === "verifying-password") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
        <div className="mb-8"><Logo size="md" /></div>
        <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-md space-y-5">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mx-auto mb-3">
              <Lock size={20} className="text-blue-400" />
            </div>
            <h1 className="text-xl font-bold text-white">Welcome back!</h1>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              You already have a ClipWise account with <span className="text-white font-medium">{userEmail}</span>. Sign in with your existing password to continue.
            </p>
          </div>

          {pwError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{pwError}</p>
            </div>
          )}

          <form onSubmit={verifyPassword} className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-300">Password</label>
                <a href="/forgot-password" className="text-xs text-gold hover:underline">Forgot password?</a>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Your existing ClipWise password" autoFocus
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" loading={status === "verifying-password"}>
              {status === "verifying-password" ? "Verifying…" : "Sign In & Enter Dashboard"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── Password setup screen ───────────────────────────────────────────────────
  if (status === "password" || status === "saving-password") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
        <div className="mb-8"><Logo size="md" /></div>
        <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-md space-y-5">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center mx-auto mb-3">
              <Lock size={20} className="text-gold" />
            </div>
            <h1 className="text-xl font-bold text-white">Set your password</h1>
            <p className="text-sm text-gray-400 mt-1">One last step before your barber dashboard.</p>
          </div>

          {pwError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{pwError}</p>
            </div>
          )}

          <form onSubmit={savePassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">New password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters, 1 capital, 1 number" autoFocus
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[0,1,2].map(i => (
                      <div key={i} className={cn("flex-1 h-1 rounded-full",
                        pwStrength.score > i
                          ? pwStrength.strength === "strong" ? "bg-emerald-400"
                          : pwStrength.strength === "medium" ? "bg-yellow-400" : "bg-red-400"
                          : "bg-surface")} />
                    ))}
                  </div>
                  <p className={cn("text-xs", pwStrength.strength === "strong" ? "text-emerald-400" : pwStrength.strength === "medium" ? "text-yellow-400" : "text-red-400")}>
                    {pwStrength.strength === "strong" ? "Strong" : `${pwStrength.strength === "medium" ? "Medium" : "Weak"} — ${pwStrength.issues.join(", ")}`}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Confirm password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type={showPw ? "text" : "password"} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50" />
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" loading={status === "saving-password"}>
              {status === "saving-password" ? "Saving…" : "Save & Enter Dashboard"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── Loading / linking / done / error screens ─────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="mb-10"><Logo size="md" /></div>
      <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-sm text-center">
        {status === "loading" && (
          <>
            <div className="w-10 h-10 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-4" />
            <p className="font-semibold text-white">Verifying your invite…</p>
            <p className="text-sm text-gray-500 mt-1">Just a moment</p>
          </>
        )}
        {status === "linking" && (
          <>
            <div className="w-10 h-10 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-4" />
            <p className="font-semibold text-white">Setting up your account…</p>
            <p className="text-sm text-gray-500 mt-1">Linking you to your shop</p>
          </>
        )}
        {status === "done" && (
          <>
            <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✂️</span>
            </div>
            <p className="font-bold text-white text-lg">You&apos;re all set!</p>
            <p className="text-sm text-gray-400 mt-1">Taking you to your barber dashboard…</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🔗</span>
            </div>
            <p className="font-bold text-white text-lg mb-2">Invite error</p>
            <p className="text-sm text-gray-400">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}
