"use client";

/**
 * SwipeNavigator — wraps a page's content and enables native-feeling horizontal
 * swipe navigation between the app's primary tab pages.
 *
 * All gesture/animation logic lives in `useSwipeNavigation`; this component only
 * provides the DOM host. Two nested divs by design:
 *
 *   • outer (.cw-swipe-clip, overflow-x-clip) — STATIC. Clips the page as it
 *     slides past the viewport edge so the off-screen part can't create a
 *     horizontal scrollbar. `overflow: clip` (not hidden) avoids making it a
 *     scroll container, so `position: sticky` inside pages still works.
 *   • inner (.cw-swipe-root) — the element the hook transforms. At rest it
 *     carries NO transform / will-change, so it's transparent to layout and
 *     never traps `position: fixed` descendants. Both divs are auto-height
 *     block boxes (identical to the <main> they sit in), so wrapping changes no
 *     height/scroll behavior.
 *
 * Opt a region out by adding `data-no-swipe` (the calendar does this). Carousels
 * and other horizontally-scrollable regions are auto-excluded, and any open
 * bottom sheet / modal (which locks body scroll) pauses swipe nav globally.
 *
 * Mouse-drag and trackpad-wheel navigation are implemented but OFF by default
 * (pass `enableMouse` / `enableWheel`) to avoid desktop false-positives near
 * text selection and horizontal scroll regions. Touch + keyboard are on.
 */

import { useRef } from "react";
import { useSwipeNavigation, type SwipeNavConfig } from "@/hooks/use-swipe-navigation";

export function SwipeNavigator({
  order,
  children,
  ...config
}: { children: React.ReactNode } & Omit<SwipeNavConfig, "order"> & { order: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipeNavigation(ref, { order, ...config });
  return (
    <div className="cw-swipe-clip overflow-x-clip">
      <div ref={ref} className="cw-swipe-root">
        {children}
      </div>
    </div>
  );
}
