"use client";
import { useEffect, useRef } from "react";

/**
 * Fire `reset` whenever the page returns to the foreground after a redirect —
 * restored from the back-forward cache (iOS/Safari freeze the page's JS state,
 * which strands any loading spinner) or the tab/app regaining visibility.
 *
 * Use it to clear a button's loading flag after redirecting to Stripe: without
 * it, tapping the browser/PWA Back button after a checkout / Connect / card
 * redirect leaves the button spinning forever, because the page comes back with
 * its old `loading = true` state frozen in place.
 *
 * `reset` is read through a ref so the listeners bind once and stay stable even
 * if the callback identity changes each render.
 */
export function useResetOnReturn(reset: () => void) {
  const ref = useRef(reset);
  ref.current = reset;
  useEffect(() => {
    const fire = () => ref.current();
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) fire(); };
    const onVisible = () => { if (document.visibilityState === "visible") fire(); };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
