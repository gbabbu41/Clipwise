"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Mail, Lock, Phone, AlertCircle, ShieldCheck, Store } from "lucide-react";
import { AuthShell } from "@/components/marketing/auth-shell";
import { supabase } from "@/lib/supabase";
import { formatPhone, validatePhone, validateEmail, getPasswordStrength } from "@/lib/validation";

type SelectedRole = "" | "shop_owner" | "customer";

// Set NEXT_PUBLIC_TURNSTILE_SITE_KEY in Vercel to switch CAPTCHA on. Until then
// the widget doesn't render and the server skips verification, so signup works.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

interface TurnstileApi { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void }

export default function SignupPage() {
  const router = useRouter();
  // The role picker was removed — /signup is the barber/shop-owner funnel (every
  // marketing CTA points here for owners; customers book through a shop's public
  // storefront, no account needed). Default straight to shop_owner so signup is
  // one tap shorter. Kept as SelectedRole so the API role param stays unchanged.
  const selectedRole: SelectedRole = "shop_owner";
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

  // A short-lived HttpOnly capability supplies a draft, not authentication.
  // Keep the email out of URLs and browser storage; never overwrite typing.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketing/start", { cache: "no-store", signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (controller.signal.aborted || typeof data?.draft?.email !== "string") return;
        setForm(previous => previous.email ? previous : { ...previous, email: data.draft.email });
      }).catch(() => null);
    return () => controller.abort();
  }, []);

  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetRendered = useRef(false);

  // Arriving from a pricing card (/signup?plan=pro) → carry their plan choice
  // into onboarding.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("plan");
    if (p && ["starter", "pro", "premium"].includes(p)) setPlan(p);
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
  const handleRequestCode = async (e?: React.FormEvent, opts?: { resend?: boolean }) => {
    e?.preventDefault?.();
    setError("");
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Full name is required";
    const emailErr = validateEmail(form.email);
    if (emailErr) errors.email = emailErr;
    // Phone is optional at signup — only validate what's actually entered. The
    // shop's public phone is collected (also optional) later in onboarding.
    if (form.phone.trim()) {
      const phoneErr = validatePhone(form.phone);
      if (phoneErr) errors.phone = phoneErr;
    }
    if (pwStrength.issues.length > 0) errors.password = pwStrength.issues.join(" · ");
    if (form.confirmPassword !== form.password) errors.confirmPassword = "Passwords do not match";
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    // A resend skips the client captcha gate — the widget only shows on the form
    // step, so requiring a fresh token here would dead-end "Resend code". The
    // server still only exempts a resend that already has a pending (captcha-
    // passed) code on file.
    if (!opts?.resend && TURNSTILE_SITE_KEY && !captchaToken) { setError("Please complete the “I'm human” check."); return; }
    setFieldErrors({});
    setLoading(true);

    const res = await withTimeout(
      () => fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim().toLowerCase(), role: selectedRole || "customer", captchaToken, resend: !!opts?.resend }),
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
    // Remove the prefill capability after verification; it never grants access.
    void fetch("/api/marketing/start", { method: "DELETE" }).catch(() => null);
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: form.email.trim().toLowerCase(), password: form.password });
    if (signInErr) { setLoading(false); router.push("/login"); return; }

    const role = selectedRole || "customer";
    if (role !== "shop_owner") { setLoading(false); router.push("/"); return; }

    // Every owner explicitly chooses a plan before shop creation. A pricing-card
    // choice is a suggestion, not consent to start a subscription or a trial.
    setLoading(false);
    const picked = ["starter", "pro", "premium"].includes(plan) ? `?plan=${plan}` : "";
    router.push(`/onboarding/plan${picked}`);
  };

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = key === "phone" ? formatPhone(e.target.value) : e.target.value;
    setForm(prev => ({ ...prev, [key]: val }));
    if (fieldErrors[key]) setFieldErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const fields = [
    { key: "name" as const, label: "Full Name", placeholder: "Marcus Johnson", icon: User, type: "text" },
    { key: "email" as const, label: "Email Address", placeholder: "you@example.com", icon: Mail, type: "email" },
    { key: "phone" as const, label: "Phone Number (optional)", placeholder: "(506) 555-0123", icon: Phone, type: "tel" },
  ];

  if (signupsPaused) {
    return (
      <AuthShell title="Sign-ups are paused">
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
          <div className="logo-fb"><Store size={24} style={{ color: "var(--ok)" }} /></div>
          <p className="lead" style={{ fontSize: 14, textAlign: "center" }}>We&rsquo;re not accepting new accounts right now. Please check back soon.</p>
          <Link href="/login" className="pill g full" style={{ marginTop: 4 }}>Already have an account? Sign in</Link>
        </div>
      </AuthShell>
    );
  }

  const onCodeStep = selectedRole && step === "code";
  const pwColor = pwStrength.strength === "strong" ? "#F5F4F7" : pwStrength.strength === "medium" ? "#E0B341" : "#ff6b6b";
  const badBorder = { borderColor: "rgba(255,90,90,.55)" };

  return (
    <AuthShell
      title={step === "form" ? "Create your account" : undefined}
      subtitle={step === "form" ? "Set up your shop in minutes. No credit card required." : undefined}
    >
      {TURNSTILE_SITE_KEY && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer strategy="afterInteractive" />}

      {/* ── Code entry step ── */}
      {onCodeStep && (
        <div>
          <div className="logo-fb" style={{ margin: "0 auto 14px", background: "rgba(255,255,255,.07)", borderColor: "rgba(255,255,255,.16)" }}><ShieldCheck size={26} style={{ color: "var(--ok)" }} /></div>
          <h2 style={{ textAlign: "center", fontSize: 20 }}>Verify your email</h2>
          <p className="lead" style={{ textAlign: "center", fontSize: 14, marginTop: 6 }}>
            We emailed a 6-digit code to <strong style={{ color: "var(--t1)" }}>{form.email}</strong>. Enter it to finish — your account is created only after this step.
          </p>

          {error && <div className="err" style={{ marginTop: 18 }}><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}

          <form onSubmit={handleVerify} style={{ marginTop: 18 }}>
            <input
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              style={{ textAlign: "center", fontSize: 24, letterSpacing: "0.5em", fontWeight: 600 }}
            />
            <button type="submit" className="pill w full" disabled={loading} style={{ marginTop: 14 }}>
              {loading ? "Verifying…" : "Verify & create account"}
            </button>
          </form>

          <div className="authrow" style={{ marginTop: 18 }}>
            <button onClick={() => { setStep("form"); setError(""); }} className="authlink authlink-a" style={{ color: "var(--t2)", fontSize: 12.5 }}>← Edit details</button>
            <button onClick={() => handleRequestCode(undefined, { resend: true })} disabled={loading} className="authlink authlink-a" style={{ color: "var(--t2)", fontSize: 12.5 }}>Resend code</button>
          </div>
        </div>
      )}

      {/* ── Details form step ── */}
      {step === "form" && (
        <div>
          {error && error !== "already_registered" && <div className="err"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}

          {/* noValidate: run OUR validation (validateEmail, password match) so
              errors show inline, instead of the browser's native bubble
              pre-empting submit and flashing away. */}
          <form onSubmit={handleRequestCode} noValidate>
            {fields.map(({ key, label, placeholder, icon: Icon, type }) => (
              <div key={key} className="field">
                <label htmlFor={`signup-${key}`}>{label}</label>
                <div className="ip">
                  <Icon size={16} className="lic" />
                  <input type={type} id={`signup-${key}`} name={key} className="pl"
                    autoComplete={key === "email" ? "email" : key === "phone" ? "tel" : key === "name" ? "name" : "off"}
                    autoFocus={key === "name"} value={form[key as keyof typeof form]} onChange={update(key as keyof typeof form)} placeholder={placeholder}
                    style={fieldErrors[key] ? badBorder : undefined} />
                </div>
                {fieldErrors[key] && (
                  <p className="ferr">
                    <AlertCircle size={11} /> {fieldErrors[key]}
                    {key === "email" && error === "already_registered" && <Link href="/login">Sign in instead →</Link>}
                  </p>
                )}
              </div>
            ))}

            <div className="field">
              <label htmlFor="signup-password">Password</label>
              <div className="ip">
                <Lock size={16} className="lic" />
                <input type={showPass ? "text" : "password"} id="signup-password" name="password" className="pl pr" autoComplete="new-password" value={form.password} onChange={update("password")} placeholder="Min. 8 characters, 1 capital, 1 number"
                  style={fieldErrors.password ? badBorder : undefined} />
                <button type="button" aria-label={showPass ? "Hide password" : "Show password"} onClick={() => setShowPass(!showPass)} className="eye">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {form.password && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: pwStrength.score > i ? pwColor : "var(--line2)" }} />
                    ))}
                  </div>
                  <p style={{ fontSize: 12, marginTop: 5, color: pwColor }}>
                    {pwStrength.strength === "strong" ? "Strong password" : pwStrength.strength === "medium" ? "Medium — " + pwStrength.issues.join(", ") : "Weak — " + pwStrength.issues.join(", ")}
                  </p>
                </div>
              )}
              {fieldErrors.password && !form.password && <p className="ferr"><AlertCircle size={11} /> {fieldErrors.password}</p>}
            </div>

            <div className="field">
              <label htmlFor="signup-confirm-password">Confirm Password</label>
              <div className="ip">
                <Lock size={16} className="lic" />
                <input type={showConfirm ? "text" : "password"} id="signup-confirm-password" name="confirmPassword" className="pl pr" autoComplete="new-password" value={form.confirmPassword} onChange={update("confirmPassword")} placeholder="Re-enter your password"
                  style={fieldErrors.confirmPassword ? badBorder : undefined} />
                <button type="button" aria-label={showConfirm ? "Hide password" : "Show password"} onClick={() => setShowConfirm(!showConfirm)} className="eye">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {fieldErrors.confirmPassword && <p className="ferr"><AlertCircle size={11} /> {fieldErrors.confirmPassword}</p>}
            </div>

            {TURNSTILE_SITE_KEY && <div ref={turnstileRef} style={{ display: "flex", justifyContent: "center", marginBottom: 15 }} />}

            <p className="fine" style={{ marginBottom: 15, lineHeight: 1.5 }}>
              By signing up, you agree to our{" "}
              <Link href="/terms" style={{ color: "var(--t1)", textDecoration: "underline" }}>Terms of Service</Link> and{" "}
              <Link href="/privacy" style={{ color: "var(--t1)", textDecoration: "underline" }}>Privacy Policy</Link>.
            </p>

            <button type="submit" className="pill w full" disabled={loading}>
              {loading ? "Sending code…" : "Continue"}
            </button>
          </form>

          <p className="authfoot">Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
      )}
    </AuthShell>
  );
}
