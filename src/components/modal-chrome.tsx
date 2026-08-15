"use client";

import { useEffect } from "react";

/**
 * Global modal chrome — mount once per portal layout. While ANY modal overlay is
 * open it:
 *   1. locks the page behind it (iOS-safe: pins the body, restores scroll on
 *      close) so swipes scroll the card, not the page;
 *   2. hides the bottom nav (adds `cw-modal-open` to <body>) so cards never
 *      overlap it;
 *   3. gives the card an elastic rubber-band stretch when pulled past its top or
 *      bottom edge, springing back on release.
 *
 * It works without touching individual modals because every modal in the app
 * shares the same markup: a full-screen `bg-black/NN` backdrop + a centered
 * `overflow-y-auto` container whose first child is the card.
 */

// A full-screen translucent backdrop = a modal is open.
const BACKDROP_SEL = ".fixed.inset-0[class*='bg-black/']";
// The centered, scrollable modal container (its first child is the card).
const CONTAINER_SEL = "div.fixed.inset-0.items-center.justify-center.overflow-y-auto";
const SPRING = "transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)";

export function ModalChrome() {
  useEffect(() => {
    let open = false;

    // ── rubber-band drag state ──
    let container: HTMLElement | null = null;
    let startY = 0;
    let active = false;
    const cardOf = (c: HTMLElement | null) => (c?.firstElementChild as HTMLElement | null) ?? c;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { active = false; container = null; return; }
      container = (e.target as HTMLElement)?.closest?.(CONTAINER_SEL) as HTMLElement | null;
      if (!container) { active = false; return; }
      startY = e.touches[0].clientY;
      active = true;
      const card = cardOf(container);
      if (card) card.style.transition = "none";
    };

    const onMove = (e: TouchEvent) => {
      if (!active || !container) return;
      const card = cardOf(container);
      if (!card) return;
      const delta = e.touches[0].clientY - startY;
      const atTop = container.scrollTop <= 0;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      // Only stretch when pulling PAST an edge; otherwise let it scroll.
      if ((delta > 0 && atTop) || (delta < 0 && atBottom)) {
        e.preventDefault();
        const damped = Math.sign(delta) * Math.min(150, Math.pow(Math.abs(delta), 0.82));
        card.style.transform = `translateY(${damped}px)`;
      } else {
        card.style.transform = "translateY(0px)";
      }
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      const card = cardOf(container);
      if (card) { card.style.transition = SPRING; card.style.transform = "translateY(0px)"; }
      container = null;
    };

    const addListeners = () => {
      document.addEventListener("touchstart", onStart, { passive: true });
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd, { passive: true });
      document.addEventListener("touchcancel", onEnd, { passive: true });
    };
    const removeListeners = () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };

    // Lock the background scroll with overflow:hidden — NOT position:fixed on
    // <body>. position:fixed makes bottom-anchored fixed modals stop short of the
    // home-indicator in an installed PWA (a black strip appears under the sheet),
    // because their bottom:0 anchors to the shifted body box instead of the true
    // viewport. overflow:hidden freezes the background in place (scroll position
    // preserved, no jump) while letting modals reach the real screen bottom.
    const lock = () => {
      if (open) return;
      open = true;
      const b = document.body;
      const h = document.documentElement;
      b.style.overflow = "hidden";
      h.style.overflow = "hidden";
      b.style.overscrollBehavior = "none";
      b.classList.add("cw-modal-open");
      addListeners();
    };
    const unlock = () => {
      if (!open) return;
      open = false;
      const b = document.body;
      const h = document.documentElement;
      b.style.overflow = "";
      h.style.overflow = "";
      b.style.overscrollBehavior = "";
      b.classList.remove("cw-modal-open");
      removeListeners();
    };

    const sync = () => {
      const present = !!document.querySelector(BACKDROP_SEL);
      if (present) lock(); else unlock();
    };

    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => { mo.disconnect(); unlock(); };
  }, []);

  return null;
}
