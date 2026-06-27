"use client";

/**
 * useSheetDrag — iOS-style drag-to-dismiss for a bottom sheet, applied to the
 * WHOLE sheet (not just the handle) and aware of inner scrolling.
 *
 * Behavior: a downward drag dismisses the sheet, but if the gesture starts
 * inside a vertically-scrollable region that isn't scrolled to the top, that
 * region scrolls instead (so you can scroll a long sheet normally). Once the
 * content is at the top, pulling down further drags the sheet and — past a
 * distance/velocity threshold — dismisses it. Form controls never initiate a
 * drag (so inputs/selects stay usable).
 *
 * Touch-only (the primary ask is mobile): listeners are attached natively so the
 * move handler can be non-passive and preventDefault while dragging — the only
 * reliable way to take over from native scroll without globally killing it.
 *
 * Returns { dragY, dragging } to drive the sheet's transform; the caller keeps
 * its own open/close + slide animation (drag and slide compose cleanly because
 * dragY is 0 at rest, so there's no transform fighting the slide).
 */

import { useEffect, useRef, useState } from "react";

export function useSheetDrag(
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  opts: { enabled?: boolean; threshold?: number } = {},
) {
  const { enabled = true, threshold = 110 } = opts;
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Keep onDismiss in a ref so the listeners bind once, not every render.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof window === "undefined") return;

    let startY = 0;
    let startT = 0;
    let mode: "" | "drag" | "scroll" = "";
    let scroller: HTMLElement | null = null;

    // Nearest vertically-scrollable element between the touch target and the
    // sheet (falling back to the sheet itself if it's the scroller).
    const findScroller = (target: EventTarget | null): HTMLElement | null => {
      let n = target as HTMLElement | null;
      const stop = el.parentElement;
      while (n && n !== stop) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
        if (n === el) break;
        n = n.parentElement;
      }
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
      return null;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { mode = "scroll"; return; }
      const t = e.touches[0];
      startY = t.clientY;
      startT = e.timeStamp;
      mode = "";
      const tgt = e.target as HTMLElement;
      if (tgt.closest?.("input, textarea, select, [role='slider'], [data-no-sheet-drag]")) { mode = "scroll"; return; }
      scroller = findScroller(e.target);
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "scroll") return;
      const dy = e.touches[0].clientY - startY;
      if (mode === "") {
        const atTop = !scroller || scroller.scrollTop <= 0;
        if (dy > 4 && atTop) mode = "drag";          // overscroll at top → drag sheet
        else if (Math.abs(dy) > 4) { mode = "scroll"; return; } // let content scroll
        else return;                                  // not enough movement yet
      }
      if (mode === "drag") {
        if (e.cancelable) e.preventDefault();         // take over from native scroll
        setDragging(true);
        setDragY(Math.max(0, dy));
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (mode === "drag") {
        const dy = Math.max(0, (e.changedTouches[0]?.clientY ?? startY) - startY);
        const vel = dy / Math.max(1, e.timeStamp - startT);
        if (dy > threshold || vel > 0.5) { setDragging(false); setDragY(0); dismissRef.current(); return; }
      }
      setDragging(false);
      setDragY(0);
      mode = "";
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled, threshold]);

  return { dragY, dragging };
}
