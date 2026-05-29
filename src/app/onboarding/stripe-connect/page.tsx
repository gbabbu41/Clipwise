"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Shield, Clock, ArrowRight, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export default function StripeConnectPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    if (!accessToken) { setError("Please sign in again to continue."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.error ?? "Could not start Stripe Connect."); setLoading(false); return; }
      window.location.href = data.url; // Stripe hosted onboarding
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo size="md" className="justify-center mb-6" />
          <div className="w-14 h-14 rounded-2xl bg-gold/15 border border-gold/30 flex items-center justify-center mx-auto mb-5">
            <Building2 size={26} className="text-gold" />
          </div>
          <h1 className="text-2xl font-bold text-white">Connect your bank account</h1>
          <p className="text-gray-400 text-sm mt-2 leading-relaxed">
            Receive customer payments directly to your bank. Powered by Stripe.
          </p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Shield size={16} className="text-gold flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-300">Stripe handles all security and verification — your banking details never touch ClipWise.</p>
            </div>
            <div className="flex items-start gap-3">
              <Clock size={16} className="text-gold flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-300">Takes 2–3 minutes. You&apos;ll provide your legal name, address, and bank account.</p>
            </div>
          </div>

          <Button className="w-full" size="lg" loading={loading} onClick={connect}>
            Connect with Stripe <ArrowRight size={16} />
          </Button>

          <button
            onClick={() => router.push("/dashboard")}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            I&apos;ll do this later →
          </button>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          You can complete this anytime from your billing settings.
        </p>
      </div>
    </div>
  );
}
