"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Mail, Lock, Phone, AlertCircle, ShieldCheck, Store, Calendar } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatPhone, validatePhone, validateEmail, getPasswordStrength } from "@/lib/validation";

type SelectedRole = "" | "shop_owner" | "customer";

// Set NEXT_PUBLIC_TURNSTILE_SITE_KEY in Vercel to switch CAPTCHA on. Until then
// the widget doesn't render and the server skips verification, so signup works.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

interface TurnstileApi { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void }

export default function SignupPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<SelectedRole>("");
  const [step, setStep] = useState<"form" | "code">("form");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [signupsPaused, setSignupsPaused] = useState(false);
  const [plan, setPlan] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [code, setCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");

  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetRendered = useRef(false);

  // Arriving from a pricing card (/signup?plan=pro) → they're a barber/owner, so
  // skip the role picker and carry their plan choice into onboarding.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("plan");
    if (p && ["starter", "pro", "premium"].includes(p)) {
      setPlan(p);
      setSelectedRole("shop_owner");
    }
  }, []);

  const pwStrength = getPasswordStrength(form.password);

  // Admin kill-switch: if new sign-ups are paused platform-wide, block the form.
  useEffect(() => {
    fetch("/api/platform/status")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.signups_enabled === false) setSignupsPaused(true); })
      .catch(() => null);
  }, []);

  // Render the Turnstile widget on the form step, once the script is present.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || step !== "form") return;
    const iv = setInterval(() => {
      const w = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (w && turnstileRef.current && !widgetRendered.current) {
        widgetRendered.current = true;
        w.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t: string) => setCaptchaToken(t),
          "error-callback": () => setCaptchaToken(""),
          "expired-callback": () => setCaptchaToken(""),
        });
        clearInterval(iv);
      }
    }, 300);
    return () => clearInterval(iv);
  }, [step]);

  const resetCaptcha = () => {
    setCaptchaToken("");
    try { (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset(); } catch { /* noop */ }
  };

  // Guard every network call so the button can never spin forever.
  const withTimeout = async <T,>(fn: () => Promise<T>, onTimeout: () => void): Promise<T | null> => {
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; setLoading(false); onTimeout(); } }, 15000);
    try {
      const r = await fn();
      if (settled) return null;
      settled = true; clearTimeout(t);
      return r;
    } catch {
      if (settled) return null;
      settled = true; clearTimeout(t);
      setLoading(false);
      onTimeout();
      return null;
    }
  };

  // ── Step 1: validate the form, then request an email verification code. No
  //    account is created yet — the server only stores {email, code} + emails it.
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Full name is required";
    const emailErr = validateEmail(form.email);
    if (emailErr) errors.email = emailErr;
    const phoneErr = validatePhone(form.phone);
    if (phoneErr) errors.phone = phoneErr;
    if (pwStrength.issues.length > 0) errors.password = pwStrength.issues.join(" · ");
    if (form.confirmPassword !== form.password) errors.confirmPassword = "Passwords do not match";
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    if (TURNSTILE_SITE_KEY && !captchaToken) { setError("Please complete the “I'm human” check."); return; }
    setFieldErrors({});
    setLoading(true);

    const res = await withTimeout(
      () => fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim().toLowerCase(), role: selectedRole || "customer", captchaToken }),
      }),
      () => setError("This is taking a while — check your connection and try again."),
    );
    resetCaptcha();
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (res.status === 409 || data.error === "already_registered") {
      setFieldErrors({ email: "Email already in use." });
      setError("already_registered");
      return;
    }
    if (!res.ok) { setError(data.error || "Couldn't send your code. Please try again."); return; }
    setCode("");
    setStep("code");
  };

  // ── Step 2: verify the code. THIS is where the account is created (server-side,
  //    already email-confirmed), then we sign in and route on.
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code from your email."); return; }
    setLoading(true);

    const res = await withTimeout(
      () => fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(), code: code.trim(), password: form.password,
          name: form.name.trim(), phone: form.phone.trim(), role: selectedRole || "customer",
        }),
      }),
      () => setError("This is taking a while — check your connection and try again."),
    );
    if (!res) return;
    const data = await res.json().catch(() => ({}));

    if (res.status === 409 || data.error === "already_registered") {
      setLoading(false);
      setError("That email already has an account. Please sign in instead.");
      return;
    }
    if (!res.ok) { setLoading(false); setError(data.error || "Couldn't verify your code. Please try again."); return; }

    // Account created + confirmed → sign in to get a session, then route on.
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: form.email.trim().toLowerCase(), password: form.password });
    setLoading(false);
    if (signInErr) { router.push("/login"); return; }
    const planQ = plan ? `?plan=${plan}` : "";
    router.push((selectedRole || "customer") === "shop_owner" ? `/onboarding/plan${planQ}` : "/");
  };

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = key === "phone" ? formatPhone(e.target.value) : e.target.value;
    setForm(prev => ({ ...prev, [key]: val }));
    if (fieldErrors[key]) setFieldErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const fields = [
    { key: "name" as const, label: "Full Name", placeholder: "Marcus Johnson", icon: User, type: "text" },
    { key: "email" as const, label: "Email Address", placeholder: "you@example.com", icon: Mail, type: "email" },
    { key: "phone" as const, label: "Phone Number", placeholder: "(506) 555-0123", icon: Phone, type: "tel" },
  ];

  const roleOptions = [
    { role: "shop_owner" as SelectedRole, icon: Store, title: "I'm a barber or shop owner", desc: "Take bookings and get paid — solo or with a team. Pick your plan next.", accent: "border-gold/40 hover:border-gold/70", iconBg: "bg-gold/15", iconColor: "text-gold" },
    { role: "customer" as SelectedRole, icon: Calendar, title: "I'm looking to book", desc: "Find and book appointments at nearby barbershops", accent: "border-border hover:border-gray-500", iconBg: "bg-surface-raised", iconColor: "text-gray-300" },
  ];

  if (signupsPaused) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <Link href="/"><Logo size="md" className="justify-center mb-6" /></Link>
          <div className="bg-surface border border-border rounded-2xl p-8 space-y-3">
            <div className="w-14 h-14 bg-gold/10 border border-gold/30 rounded-2xl flex items-center justify-center mx-auto">
              <Store size={26} className="text-gold" />
            </div>
            <h1 className="text-xl font-bold text-white">Sign-ups are paused</h1>
            <p className="text-sm text-[#8f8f8f]">We&apos;re not accepting new accounts right now. Please check back soon.</p>
            <Link href="/login" className="block pt-2 text-gold hover:underline text-sm font-medium">Already have an account? Sign in →</Link>
          </div>
        </div>
      </div>
    );
  }

  const onCodeStep = selectedRole && step === "code";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      {TURNSTILE_SITE_KEY && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer strategy="afterInteractive" />}
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/"><Logo size="md" className="justify-center mb-4" /></Link>
          {!selectedRole && (
            <>
              <h1 className="text-2xl font-bold text-white">Join ClipWise</h1>
              <p className="text-[#8f8f8f] text-sm mt-1">How are you planning to use ClipWise?</p>
            </>
          )}
          {selectedRole && step === "form" && (
            <>
              <h1 className="text-2xl font-bold text-white">Create your account</h1>
              <p className="text-[#8f8f8f] text-sm mt-1">
                {selectedRole === "shop_owner" ? "Set up your shop in minutes. No credit card required." : "Book appointments at top barbershops near you."}
              </p>
            </>
          )}
        </div>

        {/* ── Code entry step ── */}
        {onCodeStep && (
          <div className="bg-surface border border-border rounded-2xl p-8">
            <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShieldCheck size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white text-center">Verify your email</h2>
            <p className="text-sm text-[#8f8f8f] text-center mt-1">
              We emailed a 6-digit code to <span className="text-white font-medium">{form.email}</span>. Enter it to finish — your account is created only after this step.
            </p>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mt-5">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4 mt-5">
              <input
                inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                className="w-full bg-surface-raised border border-border rounded-xl py-3 text-center text-2xl tracking-[0.5em] font-semibold text-white placeholder:text-[#3a3a3a] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50"
              />
              <Button type="submit" className="w-full" size="lg" loading={loading}>
                {loading ? "Verifying…" : "Verify & create account"}
              </Button>
            </form>

            <div className="flex items-center justify-between mt-5 text-sm">
              <button onClick={() => { setStep("form"); setError(""); }} className="text-[#8f8f8f] hover:text-gold">← Edit details</button>
              <button
                onClick={() => handleRequestCode(new Event("submit") as unknown as React.FormEvent)}
                disabled={loading}
                className="text-gold hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          </div>
        )}

        {/* ── Role picker ── */}
        {!selectedRole && (
          <div className="space-y-3">
            {roleOptions.map(({ role, icon: Icon, title, desc, accent, iconBg, iconColor }) => (
              <button key={role} onClick={() => { setSelectedRole(role); setStep("form"); }}
                className={cn("w-full flex items-center gap-4 bg-surface border rounded-2xl p-5 text-left transition-all", accent)}>
                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
                  <Icon size={22} className={iconColor} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="text-xs text-[#8f8f8f] mt-0.5">{desc}</p>
                </div>
              </button>
            ))}
            <p className="text-center text-sm text-[#8f8f8f] pt-2">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
            </p>
          </div>
        )}

        {/* ── Details form step ── */}
        {selectedRole && step === "form" && (
          <div className="bg-surface border border-border rounded-2xl p-8">
            <button onClick={() => setSelectedRole("")} className="text-xs text-[#8f8f8f] hover:text-gold mb-4 flex items-center gap-1">
              ← Back
            </button>

            {error && error !== "already_registered" && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleRequestCode} className="space-y-4">
              {fields.map(({ key, label, placeholder, icon: Icon, type }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">{label}</label>
                  <div className="relative">
                    <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                    <input type={type} value={form[key as keyof typeof form]} onChange={update(key as keyof typeof form)} placeholder={placeholder}
                      className={cn("w-full bg-surface-raised border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 transition-all",
                        fieldErrors[key] ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-gold/50 focus:border-gold/50")} />
                  </div>
                  {fieldErrors[key] && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle size={11} /> {fieldErrors[key]}
                      {key === "email" && error === "already_registered" && (
                        <Link href="/login" className="ml-1 text-gold hover:underline">Sign in instead →</Link>
                      )}
                    </p>
                  )}
                </div>
              ))}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                  <input type={showPass ? "text" : "password"} value={form.password} onChange={update("password")} placeholder="Min. 8 characters, 1 capital, 1 number"
                    className={cn("w-full bg-surface-raised border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 transition-all",
                      fieldErrors.password ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-gold/50 focus:border-gold/50")} />
                  <button type="button" aria-label={showPass ? "Hide password" : "Show password"} onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8f8f8f] hover:text-white">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {form.password && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div key={i} className={cn("flex-1 h-1 rounded-full transition-colors",
                          pwStrength.score > i
                            ? pwStrength.strength === "strong" ? "bg-emerald-400"
                            : pwStrength.strength === "medium" ? "bg-orange-400" : "bg-red-400"
                            : "bg-surface-raised")} />
                      ))}
                    </div>
                    <p className={cn("text-xs", pwStrength.strength === "strong" ? "text-emerald-400" : pwStrength.strength === "medium" ? "text-orange-400" : "text-red-400")}>
                      {pwStrength.strength === "strong" ? "Strong password" : pwStrength.strength === "medium" ? "Medium — " + pwStrength.issues.join(", ") : "Weak — " + pwStrength.issues.join(", ")}
                    </p>
                  </div>
                )}
                {fieldErrors.password && !form.password && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={11} /> {fieldErrors.password}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Confirm Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                  <input type={showConfirm ? "text" : "password"} value={form.confirmPassword} onChange={update("confirmPassword")} placeholder="Re-enter your password"
                    className={cn("w-full bg-surface-raised border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 transition-all",
                      fieldErrors.confirmPassword ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-gold/50 focus:border-gold/50")} />
                  <button type="button" aria-label={showConfirm ? "Hide password" : "Show password"} onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8f8f8f] hover:text-white">
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {fieldErrors.confirmPassword && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={11} /> {fieldErrors.confirmPassword}</p>}
              </div>

              {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="flex justify-center" />}

              <p className="text-xs text-[#8f8f8f] leading-relaxed">
                By signing up, you agree to our{" "}
                <Link href="/terms" className="text-gold hover:underline">Terms of Service</Link> and{" "}
                <Link href="/privacy" className="text-gold hover:underline">Privacy Policy</Link>.
              </p>

              <Button type="submit" className="w-full" size="lg" loading={loading}>
                {loading ? "Sending code…" : "Continue"}
              </Button>
            </form>

            <p className="text-center text-sm text-[#8f8f8f] mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
