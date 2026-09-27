"use client";

import { useEffect, useRef, useState } from "react";

/** Only deliberate timeline scrolling changes calendar navigation visibility. */
export function useCalendarNavVisibility(enabled: boolean) {
  const navRef = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (!enabled) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let intentUntil = 0;
    let lastTarget: HTMLElement | null = null;
    let lastTop = 0;
    let downward = 0;
    const timeline = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>("[data-calendar-canvas] [data-calendar-scroll]") : null;
    const intent = (event: Event) => {
      const target = timeline(event.target);
      if (!target) return;
      intentUntil = Date.now() + 1500;
      if (lastTarget !== target) { lastTarget = target; lastTop = target.scrollTop; downward = 0; }
    };
    const scroll = (event: Event) => {
      const target = timeline(event.target);
      if (!target || event.target !== target) return;
      const top = Math.max(0, target.scrollTop);
      const delta = top - lastTop;
      lastTop = top;
      lastTarget = target;
      if (Date.now() > intentUntil) return;
      intentUntil = Date.now() + 1500;
      if (delta < 0 || top === 0) { downward = 0; setHidden(false); }
      else {
        downward += delta;
        if (downward >= 12 && !navRef.current?.contains(document.activeElement)) setHidden(true);
      }
      clearTimeout(idle);
      idle = setTimeout(() => { downward = 0; setHidden(false); }, 700);
    };
    document.addEventListener("wheel", intent, { capture: true, passive: true });
    document.addEventListener("touchmove", intent, { capture: true, passive: true });
    document.addEventListener("keydown", intent, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      clearTimeout(idle);
      document.removeEventListener("wheel", intent, true);
      document.removeEventListener("touchmove", intent, true);
      document.removeEventListener("keydown", intent, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [enabled]);
  useEffect(() => { if (navRef.current) navRef.current.inert = hidden; }, [hidden]);
  return { navRef, hidden };
}
