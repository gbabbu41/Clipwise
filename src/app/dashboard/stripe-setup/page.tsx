"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The old multi-step Stripe demo lives on as Billing + onboarding/stripe-connect.
// Keep this route working (links/bookmarks) by redirecting to the real page.
export default function StripeSetupPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard/billing"); }, [router]);
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-sm text-[#8f8f8f]">Redirecting to Billing…</p>
    </div>
  );
}
