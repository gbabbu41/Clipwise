"use client";

/**
 * use-swipe-navigation — a centralized, GPU-accelerated horizontal swipe
 * navigator for moving between the app's primary tab pages, tuned to feel like
 * native iOS / Material page transitions.
 *
 * Design goals & safety constraints (this app already ships a lot of bespoke
 * horizontal-gesture UI — the Apple-style calendar, scroll-snap carousels, and
 * drag-to-dismiss bottom sheets — so the navigator is deliberately conservative):
 *
 *  • Only the routes in `order` participate. Deep pages reached via the "More"
 *    drawer never navigate by swipe (index === -1 → no-op), so a stray swipe on
 *    an arbitrary screen can't whisk the user somewhere surprising.
 *  • At rest the host element carries NO transform and NO will-change. That
 *    matters because either one establishes a containing block that would break
 *    `position: fixed` descendants (toasts, FABs, sheets rendered inside a page).
 *    We only touch transform/will-change for the brief moment of a drag or the
 *    settle/enter animation, then clear it.
 *  • A gesture is ignored when it begins inside: a form control, an element
 *    flagged `data-no-swipe` (e.g. the calendar), a horizontally-scrollable
 *    ancestor (carousels, wide tables, chip rows), or while any modal/sheet has
 *    locked body scroll (`document.body.style.overflow === "hidden"`).
 *  • Vertical scrolling is never hijacked: we leave `touch-action: auto` (so
 *    nested carousels keep their horizontal pan) and only `preventDefault` once
 *    we've locked into a horizontal gesture, via a non-passive touchmove
 *    listener. Vertical-dominant moves are released back to the browser.
 *  • Respects `prefers-reduced-motion` (navigates instantly, no transform) and
 *    RTL (`dir="rtl"` flips left/right ↔ next/prev).
 *
 * Gesture detection → animation → navigation flow:
 *   1. touchstart records the origin + decides if the gesture is eligible.
 *   2. touchmove locks to 'h' (horizontal) or 'v' (vertical) once it clears a
 *      few px; while 'h', the page follows the finger with rubber-band damping
 *      at the ends of the tab list.
 *   3. touchend commits when distance > threshold OR velocity is high enough,
 *      otherwise springs back. A commit slides the current page out, pushes the
 *      route, then slides the incoming page in from the opposite edge.
 */

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

export interface SwipeNavConfig {
  /** Ordered list of route hrefs that participate in swipe nav (the tab order). */
  order: string[];
  /** Fraction of viewport width a drag must pass to commit. Default 0.30 (~30%). */
  threshold?: number;
  /** Velocity (px/ms) that commits a swipe regardless of distance. Default 0.4. */
  velocity?: number;
  /** Slide-out / slide-in animation duration (ms) per phase. Default 300. */
  duration?: number;
  /** Left/right edge zone (px) for iOS-style edge swipe (bypasses scroll guard). Default 24. */
  edgePx?: number;
  /** Desktop mouse-drag navigation. Default false (off — avoids text-selection / click conflicts). */
  enableMouse?: boolean;
  /** Trackpad horizontal-wheel navigation. Default false (off — avoids false positives near scroll regions). */
  enableWheel?: boolean;
  /** Left/Right arrow-key navigation. Default true (guarded against inputs / open modals). */
  enableKeyboard?: boolean;
}

type Dir = "next" | "prev";

const SPRING = "cubic-bezier(.32,.72,0,1)"; // iOS-like spring-ish ease

/** Resolve the active index within `order`, supporting nested routes. */
function resolveIndex(pathname: string, order: string[]): number {
  const exact = order.indexOf(pathname);
  if (exact !== -1) return exact;
  // Nested route (e.g. /dashboard/payments/123) → longest non-root prefix.
  let best = -1;
  let bestLen = 0;
  order.forEach((href, idx) => {
    const isRoot = href === "/dashboard" || href === "/barber-dashboard";
    if (!isRoot && pathname.startsWith(href + "/") && href.length > bestLen) {
      best = idx;
      bestLen = href.length;
    }
  });
  return best;
}

export function useSwipeNavigation(
  elRef: React.RefObject<HTMLElement>,
  config: SwipeNavConfig,
) {
  const router = useRouter();
  const pathname = usePathname();

  // Live config / route kept in refs so the once-attached native listeners
  // always read fresh values without re-binding.
  const cfgRef = useRef<Required<SwipeNavConfig>>({
    order: [],
    threshold: 0.3,
    velocity: 0.4,
    duration: 300,
    edgePx: 24,
    enableMouse: false,
    enableWheel: false,
    enableKeyboard: true,
  });
  cfgRef.current = { ...cfgRef.current, ...config };
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // After a committed swipe we stash the direction so the pathname effect can
  // play the matching "enter" animation once the new page mounts.
  const pendingEnterRef = useRef<Dir | null>(null);

  // ── Helpers that read/write the host element's transform ──────────────────
  const widthOf = () => elRef.current?.getBoundingClientRect().width || window.innerWidth;

  const setStyle = (
    x: number,
    opts: { transition?: string; scale?: number; opacity?: number; shadow?: boolean } = {},
  ) => {
    const el = elRef.current;
    if (!el) return;
    const { transition = "", scale = 1, opacity = 1, shadow = false } = opts;
    el.style.transition = transition;
    el.style.transform = `translate3d(${x}px,0,0) scale(${scale})`;
    el.style.opacity = String(opacity);
    // Subtle depth between the moving page and the surface behind it.
    el.style.boxShadow = shadow ? "0 0 32px rgba(0,0,0,0.5)" : "";
    el.style.willChange = "transform";
  };

  // Return to a pristine layout state — crucially clears transform AND
  // will-change so `position: fixed` descendants behave normally again.
  const clearStyle = () => {
    const el = elRef.current;
    if (!el) return;
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
    el.style.boxShadow = "";
    el.style.willChange = "";
  };

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const isRTL = () =>
    typeof document !== "undefined" &&
    (document.documentElement.dir === "rtl" ||
      getComputedStyle(document.documentElement).direction === "rtl");

  /** Map a horizontal delta to a navigation direction (RTL-aware). */
  const dirFromDelta = (dx: number): Dir => {
    const leftward = dx < 0;
    if (isRTL()) return leftward ? "prev" : "next";
    return leftward ? "next" : "prev";
  };

  /** Target route for a direction, or null if there's no page that way. */
  const targetFor = (dir: Dir): string | null => {
    const { order } = cfgRef.current;
    const i = resolveIndex(pathRef.current, order);
    if (i === -1) return null;
    const j = dir === "next" ? i + 1 : i - 1;
    return j >= 0 && j < order.length ? order[j] : null;
  };

  // ── Eligibility guard ─────────────────────────────────────────────────────
  /**
   * Walk up from the touch target; bail if the gesture should not navigate.
   * `fromEdge` relaxes ONLY the horizontal-scroll guard (an intentional grab
   * from the very screen edge, iOS-style), never the input / no-swipe guards.
   */
  const shouldIgnore = (target: EventTarget | null, fromEdge: boolean): boolean => {
    // Any open sheet / modal locks body scroll — never navigate underneath it.
    if (typeof document !== "undefined" && document.body.style.overflow === "hidden") return true;

    let el = target as HTMLElement | null;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.dataset && el.dataset.noSwipe !== undefined) return true;
      const tag = el.tagName;
      const role = el.getAttribute?.("role");
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        // Interactive canvases / embeds (maps, charts, video players, iframes)
        // own their own pointer gestures — never navigate over them.
        tag === "CANVAS" ||
        tag === "IFRAME" ||
        tag === "VIDEO" ||
        (el as HTMLElement).isContentEditable ||
        role === "slider" ||
        role === "application"
      ) {
        return true;
      }
      if (!fromEdge) {
        const style = getComputedStyle(el);
        const ox = style.overflowX;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) {
          return true;
        }
      }
      el = el.parentElement;
    }
    return false;
  };

  // ── Commit / cancel / enter animations ────────────────────────────────────
  /** Slide the current page out, push the route, flag the enter direction. */
  const commit = (dir: Dir, target: string) => {
    const { duration } = cfgRef.current;
    if (prefersReducedMotion()) {
      clearStyle();
      router.push(target);
      return;
    }
    const W = widthOf();
    const toX = dir === "next" ? -W : W;
    pendingEnterRef.current = dir;
    setStyle(toX, {
      transition: `transform ${duration}ms ${SPRING}, opacity ${duration}ms linear`,
      scale: 0.98,
      opacity: 0.4,
      shadow: true,
    });
    window.setTimeout(() => router.push(target), duration);
  };

  /** Spring the page back to rest (no navigation). */
  const cancel = () => {
    const { duration } = cfgRef.current;
    const ms = Math.round(duration * 0.7);
    setStyle(0, { transition: `transform ${ms}ms ${SPRING}, opacity ${ms}ms linear`, scale: 1, opacity: 1, shadow: true });
    window.setTimeout(clearStyle, ms);
  };

  // Keep refs to the latest commit/cancel so the enter effect can read them.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // ── Enter animation: runs after a committed swipe changes the route ────────
  useEffect(() => {
    const dir = pendingEnterRef.current;
    if (!dir) return;
    pendingEnterRef.current = null;
    if (prefersReducedMotion()) {
      clearStyle();
      return;
    }
    const { duration } = cfgRef.current;
    const W = widthOf();
    const fromX = dir === "next" ? W : -W; // incoming from the opposite edge
    // Place instantly off-screen, then spring to rest on the next frame.
    setStyle(fromX, { transition: "none", scale: 0.98, opacity: 0.4, shadow: true });
    const r1 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setStyle(0, {
          transition: `transform ${duration}ms ${SPRING}, opacity ${duration}ms linear`,
          scale: 1,
          opacity: 1,
          shadow: true,
        });
        window.setTimeout(clearStyle, duration);
      }),
    );
    return () => cancelAnimationFrame(r1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ── Pointer / keyboard / wheel listeners (attached once to the host) ───────
  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof window === "undefined") return;

    // Mutable gesture state for the in-flight drag.
    let active = false;
    let lock: "h" | "v" | null = null;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dir: Dir = "next";
    let target: string | null = null;
    let fromEdge = false;
    let raf = 0;

    const reset = () => {
      active = false;
      lock = null;
      target = null;
      fromEdge = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    /** Rubber-band damping when dragging toward a non-existent page. */
    const damp = (dx: number) => {
      const W = widthOf();
      const over = Math.abs(dx);
      // Diminishing-returns resistance, asymptotic to ~0.5 * width.
      return Math.sign(dx) * (1 - 1 / (over / W + 1)) * W * 0.5;
    };

    const beginGesture = (x: number, y: number, t: number, tgt: EventTarget | null) => {
      fromEdge = x <= cfgRef.current.edgePx || x >= widthOf() - cfgRef.current.edgePx;
      if (shouldIgnore(tgt, fromEdge)) return false;
      // Only meaningful if we're on a participating page.
      if (resolveIndex(pathRef.current, cfgRef.current.order) === -1) return false;
      active = true;
      lock = null;
      startX = x;
      startY = y;
      startT = t;
      return true;
    };

    const moveGesture = (x: number, y: number, prevent: () => void) => {
      if (!active) return;
      const dx = x - startX;
      const dy = y - startY;
      if (lock === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          lock = "v"; // vertical scroll — release to the browser
          active = false;
          return;
        }
        lock = "h";
        dir = dirFromDelta(dx);
        target = targetFor(dir);
      }
      if (lock !== "h") return;
      prevent(); // we own this horizontal gesture now
      // Re-evaluate direction live (finger may reverse).
      const liveDir = dirFromDelta(dx);
      if (liveDir !== dir) {
        dir = liveDir;
        target = targetFor(dir);
      }
      if (prefersReducedMotion()) return; // detect only, no visual transform
      const x2 = target ? dx : damp(dx); // resist at the ends of the list
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setStyle(x2, { scale: 1, opacity: 1, shadow: true }));
    };

    const endGesture = (x: number, t: number) => {
      if (!active && lock !== "h") return reset();
      if (lock === "h") {
        const dx = x - startX;
        const dt = Math.max(1, t - startT);
        const vx = Math.abs(dx) / dt;
        const W = widthOf();
        const passed = Math.abs(dx) > cfgRef.current.threshold * W;
        const fast = vx > cfgRef.current.velocity;
        if (target && (passed || fast)) commitRef.current(dir, target);
        else cancel();
      }
      reset();
    };

    // — Touch (primary, all touchscreens) —
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return reset();
      const tch = e.touches[0];
      beginGesture(tch.clientX, tch.clientY, e.timeStamp, e.target);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      const tch = e.touches[0];
      moveGesture(tch.clientX, tch.clientY, () => {
        if (e.cancelable) e.preventDefault();
      });
    };
    const onTouchEnd = (e: TouchEvent) => endGesture(e.changedTouches[0]?.clientX ?? startX, e.timeStamp);

    // — Mouse drag (desktop, opt-in) —
    let mouseDown = false;
    const onMouseDown = (e: MouseEvent) => {
      if (!cfgRef.current.enableMouse || e.button !== 0) return;
      if (beginGesture(e.clientX, e.clientY, e.timeStamp, e.target)) mouseDown = true;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      moveGesture(e.clientX, e.clientY, () => e.preventDefault());
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!mouseDown) return;
      mouseDown = false;
      endGesture(e.clientX, e.timeStamp);
    };

    // — Trackpad horizontal wheel (opt-in) —
    let wheelAccum = 0;
    let wheelLock = false;
    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!cfgRef.current.enableWheel) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical intent
      if (shouldIgnore(e.target, false)) return;
      if (resolveIndex(pathRef.current, cfgRef.current.order) === -1) return;
      if (wheelLock) return;
      wheelAccum += e.deltaX;
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => { wheelAccum = 0; }, 200);
      if (Math.abs(wheelAccum) > 120) {
        const d = dirFromDelta(-wheelAccum); // wheel deltaX is inverted vs drag
        const tgt = targetFor(d);
        wheelAccum = 0;
        if (tgt) {
          wheelLock = true;
          commitRef.current(d, tgt);
          window.setTimeout(() => { wheelLock = false; }, cfgRef.current.duration + 200);
        }
      }
    };

    // — Keyboard arrows —
    const onKeyDown = (e: KeyboardEvent) => {
      if (!cfgRef.current.enableKeyboard) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.body.style.overflow === "hidden") return; // modal open
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return;
      if (resolveIndex(pathRef.current, cfgRef.current.order) === -1) return;
      const d: Dir = (e.key === "ArrowRight") === !isRTL() ? "next" : "prev";
      const tgt = targetFor(d);
      if (tgt) {
        e.preventDefault();
        commitRef.current(d, tgt);
      }
    };

    // Passive where we never preventDefault; non-passive only for touchmove.
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", reset, { passive: true });
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", reset);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
