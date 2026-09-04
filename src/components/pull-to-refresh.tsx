"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pull-to-refresh for the INSTALLED PWA (standalone), where iOS Safari's native
 * pull-to-refresh isn't available. Pull down from the top of the page to reload.
 *
 * Deliberately a no-op in a normal browser tab (the OS already provides PTR
 * there — we'd only double it up) and on desktop. Only takes over the gesture
 * when the RELEVANT scroller is at its top and the finger is clearly pulling
 * DOWN, so normal scrolling, horizontal swipe-nav, and open sheets are untouched.
 */
const THRESHOLD = 64;  // damped px pulled before a release triggers a refresh
const MAX = 96;        // damped cap so it can't be dragged forever

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const startY = useRef<number | null>(null);
  const activeRef = useRef(false);

  const setPullBoth = (v: number) => { pullRef.current = v; setPull(v); };

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    // Are we at the top of the scroller that actually governs this touch? Walk up
    // to the nearest vertically-scrollable ancestor: if there is one, honor ITS
    // scrollTop (so a mid-scrolled calendar/list never triggers a refresh);
    // otherwise the page/body scroll governs.
    const canPull = (target: EventTarget | null): boolean => {
      if (document.body.style.overflow === "hidden") return false; // an open modal/sheet
      let el = target as HTMLElement | null;
      while (el && el !== document.body && el !== document.documentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          return el.scrollTop <= 0;
        }
        el = el.parentElement;
      }
      return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) { startY.current = null; return; }
      startY.current = canPull(e.target) ? e.touches[0].clientY : null;
      activeRef.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { if (activeRef.current) { setPullBoth(0); } return; }
      if (dy > 8) {
        if (!activeRef.current) { activeRef.current = true; setDragging(true); }
        setPullBoth(Math.min(MAX, dy * 0.5));
        if (e.cancelable) e.preventDefault(); // own the gesture; stop the page bounce
      }
    };
    const onEnd = () => {
      if (startY.current == null) return;
      const trigger = activeRef.current && pullRef.current >= THRESHOLD;
      startY.current = null;
      activeRef.current = false;
      setDragging(false);
      if (trigger) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPullBoth(52);
        window.setTimeout(() => window.location.reload(), 450);
      } else {
        setPullBoth(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(1, pull / THRESHOLD);
  return (
    <div className="lg:hidden fixed inset-x-0 z-[65] flex justify-center pointer-events-none"
      style={{ top: "env(safe-area-inset-top)" }} aria-hidden={!visible}>
      <div
        style={{
          transform: `translateY(${visible ? Math.max(6, pull) : -48}px)`,
          opacity: visible ? 1 : 0,
          transition: dragging ? "none" : "transform .28s cubic-bezier(.32,.72,0,1), opacity .2s",
        }}
      >
        <div className="w-9 h-9 rounded-full bg-card-raised border border-border shadow-lg flex items-center justify-center">
          <RefreshCw
            size={17}
            className={cn("text-foreground", refreshing && "animate-spin")}
            style={refreshing ? undefined : { transform: `rotate(${progress * 300}deg)`, opacity: 0.4 + progress * 0.6 }}
          />
        </div>
      </div>
    </div>
  );
}
