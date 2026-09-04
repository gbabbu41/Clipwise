"use client";
import { HeaderControls } from "@/components/dashboard/header-controls";
import { cn } from "@/lib/utils";

/**
 * Owner-dashboard page header — the same clean top the home page uses: title
 * (+ optional subtitle) on the left, notification bell + profile on the right,
 * all on one row. The bell opens the notification popover on mobile (via the
 * `cw-open-notifs` event the sidebar listens for) and navigates on desktop.
 *
 * Pages that use this should also be listed in the layout's inline-header set
 * (so the mobile top band shrinks and the floating bell/profile is hidden),
 * keeping the top consistent with the dashboard home.
 */
export function DashboardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    // The template owns its top spacing (pt-6 lg:pt-8) so every page that drops
    // in <DashboardHeader> sits at the same distance from the top — no per-page
    // padding to drift. Pages using it give their root horizontal padding only
    // (px-*, not p-*), otherwise the top would double up. The dashboard home
    // keeps its own inline copy of this markup, so it's unaffected by this.
    // On mobile the sticky top bar carries the title + bell + profile, so this
    // header defers to it there: the title/bell/profile are desktop-only, and the
    // whole header hides on mobile when there's nothing else to show (no subtitle,
    // no action) — leaving just the bar. The subtitle + any page action stay.
    <div className={cn("cwd-hdr pt-6 lg:pt-8", !subtitle && !action && "max-lg:hidden")}>
      <div className="min-w-0">
        <h1 className="truncate max-lg:hidden">{title}</h1>
        {subtitle && <p className="cwd-sub">{subtitle}</p>}
      </div>
      <div className="cwd-cluster">
        {/* Optional page action (e.g. "add"), sits left of the universal
            bell + profile so the right cluster stays consistent everywhere. */}
        {action}
        <HeaderControls />
      </div>
    </div>
  );
}
