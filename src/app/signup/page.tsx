"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Mail, Lock, Phone, AlertCircle, CheckCircle, Store, Calendar } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type SelectedRole = "" | "shop_owner" | "customer";

export default function SignupPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<SelectedRole>("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    const { data, error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { name: form.name, phone: form.phone } },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (data.user && data.session) {
      await supabase
        .from("users")
        .update({ role: selectedRole || "customer", name: form.name, phone: form.phone })
        .eq("id", data.user.id);
      router.push(selectedRole === "shop_owner" ? "/onboarding" : "/");
    } else if (data.user && !data.session) {
      setEmailSent(true);
      setLoading(false);
    }
  };

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const fields = [
    { key: "name" as const, label: "Full Name", placeholder: "Marcus Johnson", icon: User, type: "text" },
    { key: "email" as const, label: "Email Address", placeholder: "you@example.com", icon: Mail, type: "email" },
    { key: "phone" as const, label: "Phone Number", placeholder: "(506) 555-0123", icon: Phone, type: "tel" },
  ];

  const roleOptions = [
    { role: "shop_owner" as SelectedRole, icon: Store, title: "I own a barbershop", desc: "Set up your shop and start accepting bookings", accent: "border-gold/40 hover:border-gold/70", iconBg: "bg-gold/15", iconColor: "text-gold" },
    { role: "customer" as SelectedRole, icon: Calendar, title: "I'm looking to book", desc: "Find and book appointments at nearby barbershops", accent: "border-border hover:border-gray-500", iconBg: "bg-surface-raised", iconColor: "text-gray-300" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/"><Logo size="md" className="justify-center mb-4" /></Link>
          {!selectedRole && !emailSent && (
            <>
              <h1 className="text-2xl font-bold text-white">Join ClipWise</h1>
              <p className="text-gray-500 text-sm mt-1">How are you planning to use ClipWise?</p>
            </>
          )}
          {selectedRole && !emailSent && (
            <>
              <h1 className="text-2xl font-bold text-white">Create your account</h1>
              <p className="text-gray-500 text-sm mt-1">
                {selectedRole === "shop_owner" ? "Start your 14-day free trial. No credit card required." : "Book appointments at top barbershops near you."}
              </p>
            </>
          )}
        </div>

        {emailSent && (
          <div className="bg-surface border border-border rounded-2xl p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <CheckCircle size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Check your email</h2>
            <p className="text-sm text-gray-400">We sent a confirmation link to <span className="text-white font-medium">{form.email}</span>. Click it to activate your account, then come back to sign in.</p>
            <Link href="/login" className="block mt-2 text-gold hover:underline text-sm font-medium">Go to Sign In →</Link>
          </div>
        )}

        {!emailSent && !selectedRole && (
          <div className="space-y-3">
            {roleOptions.map(({ role, icon: Icon, title, desc, accent, iconBg, iconColor }) => (
              <button key={role} onClick={() => setSelectedRole(role)}
                className={cn("w-full flex items-center gap-4 bg-surface border rounded-2xl p-5 text-left transition-all", accent)}>
                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
                  <Icon size={22} className={iconColor} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                </div>
              </button>
            ))}
            <div className="text-center pt-2">
              <p className="text-xs text-gray-600">Are you a barber looking to join a shop?{" "}
                <Link href="/signup/barber" className="text-gold hover:underline">Sign up as a barber →</Link>
              </p>
            </div>
            <p className="text-center text-sm text-gray-500 pt-2">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
            </p>
          </div>
        )}

        {!emailSent && selectedRole && (
          <div className="bg-surface border border-border rounded-2xl p-8">
            <button onClick={() => setSelectedRole("")} className="text-xs text-gray-500 hover:text-gold mb-4 flex items-center gap-1">
              ← Back
            </button>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleSignup} className="space-y-4">
              {fields.map(({ key, label, placeholder, icon: Icon, type }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">{label}</label>
                  <div className="relative">
                    <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type={type} value={form[key]} onChange={update(key)} placeholder={placeholder} required
                      className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all" />
                  </div>
                </div>
              ))}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type={showPass ? "text" : "password"} value={form.password} onChange={update("password")} placeholder="Min. 8 characters" required minLength={8}
                    className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all" />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed">
                By signing up, you agree to our{" "}
                <a href="#" className="text-gold hover:underline">Terms of Service</a> and{" "}
                <a href="#" className="text-gold hover:underline">Privacy Policy</a>.
              </p>

              <Button type="submit" className="w-full" size="lg" loading={loading}>
                {loading ? "Creating account..." : selectedRole === "shop_owner" ? "Start Free Trial" : "Create Account"}
              </Button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
