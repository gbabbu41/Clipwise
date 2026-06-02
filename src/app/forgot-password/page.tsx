"use client";
import { useState } from "react";
import Link from "next/link";
import { Mail, AlertCircle, Check } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (err) {
      setError(err.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/"><Logo size="md" className="justify-center mb-4" /></Link>
          <h1 className="text-2xl font-bold text-white">Reset your password</h1>
          <p className="text-[#777] text-sm mt-1">We&apos;ll send you a link to reset it</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={24} className="text-emerald-400" />
              </div>
              <p className="text-white font-semibold">Check your inbox</p>
              <p className="text-[#777] text-sm mt-2">
                We sent a password reset link to <span className="text-white">{email}</span>
              </p>
              <Link href="/login" className="block mt-6 text-sm text-gold hover:underline">
                Back to sign in
              </Link>
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
                  <label className="text-sm font-medium text-gray-300">Email</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@freshcutz.ca"
                      required
                      className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
              </form>
              <p className="text-center text-sm text-[#777] mt-6">
                Remember your password?{" "}
                <Link href="/login" className="text-gold hover:underline font-medium">Sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
