"use client";
import { Lock } from "lucide-react";
import { isNativeApp } from "@/lib/native-app";

/**
 * Full-page "this feature needs a higher plan" lock screen. Rendered by a
 * dashboard page when the shop's effective plan doesn't include the feature —
 * the page-level enforcement that backs up the sidebar hiding the nav link
 * (a hidden link alone doesn't stop a direct URL visit).
 *
 * In the native app (Apple IAP) there is NO upgrade path in-app: no billing link,
 * no clipwise.ca link, no tappable email, and no plan names. It shows a neutral
 * "not on your plan" line and stops there — the feature is simply unavailable
 * here. The rest of the app is never blocked.
 */
export function FeatureLock({ title, description }: { title: string; description: string }) {
  const native = isNativeApp();
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-14 h-14 rounded-2xl bg-card-raised border border-border flex items-center justify-center mb-4">
        <Lock size={24} className="text-grey" />
      </div>
      <h2 className="text-xl font-bold text-foreground mb-2">{title}</h2>
      {/* The caller's description names plans ("available on the Pro plan"). In the
          native app that's a plan-name/upsell mention, so we show a neutral line
          instead — no plan names, no upgrade path. */}
      {native ? (
        <p className="text-sm text-grey max-w-sm">
          This isn&rsquo;t part of your current plan.
        </p>
      ) : (
        <>
          <p className="text-sm text-grey mb-6 max-w-sm">{description}</p>
          <a
            href="/dashboard/billing"
            className="inline-flex items-center gap-2 bg-white text-black text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-white/90 transition-colors"
          >
            Upgrade to unlock
          </a>
        </>
      )}
    </div>
  );
}
