"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Mail, Lock, Phone, AlertCircle, CheckCircle, Store, Calendar } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatPhone, validatePhone, validateEmail, getPasswordStrength } from "@/lib/validation";

type SelectedRole = "" | "shop_owner" | "customer";

export default function SignupPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<SelectedRole>("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [emailSent, setEmailSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "" });

  const pwStrength = getPasswordStrength(form.password);

  const handleSignup = async (e: React.FormEvent) => {
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
    setFieldErrors({});
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { name: form.name, phone: form.phone } },
    });

    if (authError) {
      if (authError.message.toLowerCase().includes("already registered") || authError.message.toLowerCase().includes("already in use")) {
        setFieldErrors({ email: "Email already in use." });
        setError("already_registered");
      } else {
        setError(authError.message);
      }
      setLoading(false);
      return;
    }

    if (data.user && data.session) {
      await supabase
        .from("users")
        .update({ role: selectedRole || "customer", name: form.name, phone: form.phone })
        .eq("id", data.user.id);
      router.push(selectedRole === "shop_owner" ? "/onboarding/plan" : "/");
    } else if (data.user && !data.session) {
      setEmailSent(true);
      setLoading(false);
    }
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
              <p className="text-[#777] text-sm mt-1">How are you planning to use ClipWise?</p>
            </>
          )}
          {selectedRole && !emailSent && (
            <>
              <h1 className="text-2xl font-bold text-white">Create your account</h1>
              <p className="text-[#777] text-sm mt-1">
                {selectedRole === "shop_owner" ? "Set up your shop in minutes. No credit card required." : "Book appointments at top barbershops near you."}
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
            <p className="text-sm text-[#777]">We sent a confirmation link to <span className="text-white font-medium">{form.email}</span>. Click it to activate your account, then come back to sign in.</p>
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
                  <p className="text-xs text-[#777] mt-0.5">{desc}</p>
                </div>
              </button>
            ))}
            <div className="text-center pt-2">
              <p className="text-xs text-[#777]">Are you a barber looking to join a shop?{" "}
                <Link href="/signup/barber" className="text-gold hover:underline">Sign up as a barber →</Link>
              </p>
            </div>
            <p className="text-center text-sm text-[#777] pt-2">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
            </p>
          </div>
        )}

        {!emailSent && selectedRole && (
          <div className="bg-surface border border-border rounded-2xl p-8">
            <button onClick={() => setSelectedRole("")} className="text-xs text-[#777] hover:text-gold mb-4 flex items-center gap-1">
              ← Back
            </button>

            {error && error !== "already_registered" && (
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
                    <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
                    <input type={type} value={form[key as keyof typeof form]} onChange={update(key as keyof typeof form)} placeholder={placeholder}
                      className={cn("w-full bg-surface-raised border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 transition-all",
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
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
                  <input type={showPass ? "text" : "password"} value={form.password} onChange={update("password")} placeholder="Min. 8 characters, 1 capital, 1 number"
                    className={cn("w-full bg-surface-raised border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 transition-all",
                      fieldErrors.password ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-gold/50 focus:border-gold/50")} />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777] hover:text-white">
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
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
                  <input type={showConfirm ? "text" : "password"} value={form.confirmPassword} onChange={update("confirmPassword")} placeholder="Re-enter your password"
                    className={cn("w-full bg-surface-raised border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 transition-all",
                      fieldErrors.confirmPassword ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-gold/50 focus:border-gold/50")} />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777] hover:text-white">
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {fieldErrors.confirmPassword && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={11} /> {fieldErrors.confirmPassword}</p>}
              </div>

              <p className="text-xs text-[#777] leading-relaxed">
                By signing up, you agree to our{" "}
                <a href="#" className="text-gold hover:underline">Terms of Service</a> and{" "}
                <a href="#" className="text-gold hover:underline">Privacy Policy</a>.
              </p>

              <Button type="submit" className="w-full" size="lg" loading={loading}>
                {loading ? "Creating account..." : selectedRole === "shop_owner" ? "Create Account" : "Create Account"}
              </Button>
            </form>

            <p className="text-center text-sm text-[#777] mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
