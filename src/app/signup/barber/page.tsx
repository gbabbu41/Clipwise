"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Mail, Lock, Phone, AlertCircle, CheckCircle, Scissors } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function BarberSignupPage() {
  const router = useRouter();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", bio: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    let userId: string | null = null;
    let freshAccount = false;

    try {
      // ── Step 1: Resolve auth identity ─────────────────────────────────────
      const { data: { session: existing } } = await supabase.auth.getSession();

      if (existing?.user?.email?.toLowerCase() === form.email.toLowerCase()) {
        // Previous attempt left a session — reuse it instead of signing up again.
        userId = existing.user.id;
      } else {
        if (existing) await supabase.auth.signOut();

        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { name: form.name, phone: form.phone, role: "barber" },
            emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
          },
        });

        // Email confirmation ON → account created but NO session yet. Don't try
        // the (RLS-protected) role update without a session; the "barber" role is
        // carried in signUp metadata + set by the handle_new_user trigger on
        // confirm. Prompt them to verify their email.
        if (authData?.user && !authData.session) {
          setEmailSent(true);
          setLoading(false);
          return;
        }

        if (authError || !authData?.user) {
          // Any auth error (including "User already registered") or null user
          // (Supabase email-enumeration protection) — recover by signing in.
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: form.email,
            password: form.password,
          });
          if (signInError || !signInData?.user) {
            // Generic message — doesn't confirm whether the email exists.
            throw new Error("Couldn't complete signup. If you already have an account, please sign in instead.");
          }
          userId = signInData.user.id;
        } else {
          userId = authData.user.id;
          freshAccount = true;
        }
      }

      if (!userId) throw new Error("Could not create your account. Please try again.");

      // ── Step 2: Set barber role ────────────────────────────────────────────
      const { error: roleError } = await supabase
        .from("users")
        .update({ role: "barber", name: form.name, phone: form.phone })
        .eq("id", userId);

      if (roleError) {
        // Trigger blocks role change for non-customer accounts (e.g. shop_owner).
        // Not fatal — account exists, just the role may not have changed.
        console.warn("[barber-signup] role update:", roleError.message);
      }

      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(msg);
      if (freshAccount) await supabase.auth.signOut();
    } finally {
      setLoading(false);
    }
  };

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/"><Logo size="md" className="justify-center mb-4" /></Link>
          <div className="w-12 h-12 bg-purple-500/15 border border-purple-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Scissors size={22} className="text-purple-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create your barber account</h1>
          <p className="text-[#8f8f8f] text-sm mt-1">Sign up and set up your shop through onboarding.</p>
        </div>

        {emailSent ? (
          <div className="bg-surface border border-border rounded-2xl p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-gold/10 border border-gold/30 rounded-2xl flex items-center justify-center mx-auto">
              <Mail size={28} className="text-gold" />
            </div>
            <h2 className="text-xl font-bold text-white">Check your email</h2>
            <p className="text-sm text-[#8f8f8f]">We sent a confirmation link to <span className="text-white">{form.email}</span>. Click it to verify your account, then you&apos;ll be taken to your dashboard.</p>
            <p className="text-xs text-[#8f8f8f]">Didn&apos;t get it? Check spam, or <Link href="/login" className="text-gold hover:underline">sign in</Link> once verified.</p>
          </div>
        ) : done ? (
          <div className="bg-surface border border-border rounded-2xl p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <CheckCircle size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Account created!</h2>
            <p className="text-sm text-[#8f8f8f]">Your barber account is ready. Sign in to access your dashboard and complete your shop setup.</p>
            <Link href="/login" className="block mt-2 text-gold hover:underline text-sm font-medium">Go to Sign In →</Link>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-2xl p-8">
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {[
                { key: "name" as const, label: "Full Name", placeholder: "Marcus Johnson", icon: User, type: "text" },
                { key: "email" as const, label: "Email Address", placeholder: "you@example.com", icon: Mail, type: "email" },
                { key: "phone" as const, label: "Phone Number", placeholder: "(506) 555-0123", icon: Phone, type: "tel" },
              ].map(({ key, label, placeholder, icon: Icon, type }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">{label}</label>
                  <div className="relative">
                    <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                    <input type={type} value={form[key]} onChange={update(key)} placeholder={placeholder} required
                      className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
                  </div>
                </div>
              ))}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
                  <input type={showPass ? "text" : "password"} value={form.password} onChange={update("password")} placeholder="Min. 8 characters" required minLength={8}
                    className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8f8f8f] hover:text-white">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Bio (optional)</label>
                <textarea value={form.bio} onChange={update("bio")} rows={3} placeholder="Tell the shop owner about your experience..."
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 resize-none" />
              </div>

              <Button type="submit" className="w-full" size="lg" loading={loading}>
                {loading ? "Creating account..." : "Create Barber Account"}
              </Button>
            </form>

            <p className="text-center text-sm text-[#8f8f8f] mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
            </p>
            <p className="text-center text-sm text-[#8f8f8f] mt-2">
              Own a barbershop?{" "}
              <Link href="/signup" className="text-gold hover:underline font-medium">Sign up as an owner</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
