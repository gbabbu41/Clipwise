import { useEffect, useRef } from "react";

/**
 * Elastic (iOS-style) overscroll for a scrollable modal card.
 *
 * Spread the returned ref onto the card's SCROLL container (it should have
 * `overflow-y-auto` + a max-height). When the user drags past the top or bottom
 * edge, the card rubber-bands with diminishing resistance and springs back on
 * release. Normal in-card scrolling is untouched — the stretch only kicks in at
 * the edges. Uses a non-passive touchmove listener so it can preventDefault, and
 * mutates the DOM directly to avoid re-rendering the parent on every frame.
 *
 * Pass `enabled` (e.g. whether the modal is open) so the listeners (re)attach
 * once the card has actually mounted.
 */
export function useRubberBand<T extends HTMLElement = HTMLDivElement>(enabled: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let startY = 0;
    let active = false;
    const SPRING = "transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)";

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      active = true;
      el.style.transition = "none";
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const delta = e.touches[0].clientY - startY;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      // Only rubber-band when pulling PAST an edge in that direction; otherwise
      // let the card scroll normally.
      if ((delta > 0 && atTop) || (delta < 0 && atBottom)) {
        e.preventDefault();
        // Diminishing returns the further you pull (caps the stretch).
        const damped = Math.sign(delta) * Math.min(150, Math.pow(Math.abs(delta), 0.82));
        el.style.transform = `translateY(${damped}px)`;
      } else {
        el.style.transform = "translateY(0px)";
      }
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      el.style.transition = SPRING;   // spring back
      el.style.transform = "translateY(0px)";
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
      el.style.transform = "";
      el.style.transition = "";
    };
  }, [enabled]);

  return ref;
}
