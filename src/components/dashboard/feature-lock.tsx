"use client";
import { Lock } from "lucide-react";

/**
 * Full-page "this feature needs a higher plan" lock screen. Rendered by a
 * dashboard page when the shop's effective plan doesn't include the feature —
 * the page-level enforcement that backs up the sidebar hiding the nav link
 * (a hidden link alone doesn't stop a direct URL visit).
 */
export function FeatureLock({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-14 h-14 rounded-2xl bg-card-raised border border-border flex items-center justify-center mb-4">
        <Lock size={24} className="text-grey" />
      </div>
      <h2 className="text-xl font-bold text-foreground mb-2">{title}</h2>
      <p className="text-sm text-grey mb-6 max-w-sm">{description}</p>
      <a
        href="/dashboard/billing"
        className="inline-flex items-center gap-2 bg-white text-black text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-white/90 transition-colors"
      >
        Upgrade to unlock
      </a>
    </div>
  );
}
