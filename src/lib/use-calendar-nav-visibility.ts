"use client";

import { useEffect, useRef, useState } from "react";

/** Mobile portal navigation follows deliberate page scrolling, never overlay chrome. */
export function useMobileNavVisibility(route: string) {
  const navRef = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    let idle: ReturnType<typeof setTimeout> | undefined;
    let intentUntil = 0;
    let intended: Element | null = null;
    let downward = 0, upward = 0;
    let touch: { x: number; y: number } | null = null;
    const positions = new WeakMap<Element, number>();
    const pageScroller = document.scrollingElement!;
    positions.set(pageScroller, pageScroller.scrollTop);
    const excluded = "aside,nav,[role=dialog],[role=menu],[role=listbox],[data-no-nav-scroll],input,textarea,select";
    const allowed = (element: Element) => {
      if (document.body.classList.contains("cw-modal-open") || element.closest(excluded)) return false;
      const main = element.closest("main.cw-main");
      if (!main) return false;
      // Positioned menus inside a page must not be mistaken for its scroll area.
      for (let node: Element | null = element; node && node !== main; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/absolute|fixed/.test(style.position) && /auto|scroll/.test(style.overflowY)) return false;
      }
      return true;
    };
    const scrollable = (element: Element) => element.scrollHeight > element.clientHeight + 1
      && /auto|scroll/.test(getComputedStyle(element).overflowY);
    document.querySelectorAll("main.cw-main .overflow-auto, main.cw-main .overflow-y-auto, [data-calendar-scroll]")
      .forEach(el => positions.set(el, el.scrollTop));
    // Resolving which element a gesture scrolls walks up the DOM calling
    // getComputedStyle — far too costly to repeat on every touchmove/wheel tick
    // (it forces style recalcs mid-scroll and made scrolling + the nav janky).
    // Resolve once per element per gesture and reuse it; the cache resets on a
    // new touch or after a 100ms pause between events (a continuous scroll fires
    // every ~16ms, so one gesture stays cached; layout changes between gestures
    // are always re-read).
    const mobile = matchMedia("(max-width: 1023px)");
    let resolved = new Map<Element, Element | null>();
    let resolvedAt = 0;
    const resolveTarget = (element: Element): Element | null => {
      const now = Date.now();
      if (now - resolvedAt > 100) resolved = new Map();
      resolvedAt = now;
      if (resolved.has(element)) return resolved.get(element)!;
      let result: Element | null = null;
      if (allowed(element)) {
        let target: Element = element;
        while (target !== document.body && !scrollable(target)) target = target.parentElement ?? document.body;
        result = target === document.body ? pageScroller : target;
      }
      resolved.set(element, result);
      return result;
    };
    const intent = (event: Event) => {
      if (!mobile.matches || !(event.target instanceof Element) || document.body.classList.contains("cw-modal-open")) return;
      if (event instanceof WheelEvent && Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (event instanceof KeyboardEvent && !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) return;
      if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
        const point = event.touches[0];
        if (!point) return;
        const previous = touch; touch = { x: point.clientX, y: point.clientY };
        if (!previous || Math.abs(point.clientX - previous.x) >= Math.abs(point.clientY - previous.y)) return;
      }
      const target = resolveTarget(event.target);
      if (!target) return;
      if (intended !== target) { intended = target; downward = 0; upward = 0; }
      if (!positions.has(target)) positions.set(target, target.scrollTop);
      intentUntil = Date.now() + 1500;
    };
    const touchStart = (event: TouchEvent) => {
      const point = event.touches[0];
      touch = point ? { x: point.clientX, y: point.clientY } : null;
      resolved = new Map();
    };
    const scroll = (event: Event) => {
      const target = event.target === document ? pageScroller : event.target;
      if (!(target instanceof Element)) return;
      const top = Math.max(0, target.scrollTop), previous = positions.get(target) ?? top;
      positions.set(target, top);
      if (target !== intended || Date.now() > intentUntil || document.body.classList.contains("cw-modal-open")) return;
      const delta = top - previous;
      if (!delta) return; // Horizontal carousel movement must not affect the timer.
      intentUntil = Date.now() + 1500;
      if (delta < 0) { downward = 0; upward -= delta; if (upward >= 12) setHidden(false); }
      else { upward = 0; downward += delta; if (downward >= 12 && !navRef.current?.contains(document.activeElement)) setHidden(true); }
      clearTimeout(idle);
      idle = setTimeout(() => { downward = 0; upward = 0; setHidden(false); }, 3000);
    };
    document.addEventListener("touchstart", touchStart, { capture: true, passive: true });
    document.addEventListener("wheel", intent, { capture: true, passive: true });
    document.addEventListener("touchmove", intent, { capture: true, passive: true });
    document.addEventListener("keydown", intent, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      clearTimeout(idle);
      document.removeEventListener("touchstart", touchStart, true);
      document.removeEventListener("wheel", intent, true);
      document.removeEventListener("touchmove", intent, true);
      document.removeEventListener("keydown", intent, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [route]);
  useEffect(() => { if (navRef.current) navRef.current.inert = hidden; }, [hidden]);
  return { navRef, hidden };
}
