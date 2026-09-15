"use client";

/**
 * Ref-counted background scroll lock — the ONE owner of `body`/`html` overflow
 * while any overlay (modal, bottom sheet, nav drawer) is open.
 *
 * WHY THIS EXISTS: several overlays used to each write `document.body.style
 * .overflow` on their own, most with a capture-and-restore ("remember the old
 * value, put it back on close"). When two overlapped — e.g. the add-appointment
 * sheet opening a confirm dialog, or a nav drawer over a modal — the second one
 * captured the FIRST one's "hidden" and restored it on close, stranding the page
 * in `overflow:hidden` forever. A stranded lock silently wedges everything that
 * treats `body.style.overflow === "hidden"` as "a modal is open": swipe-between-
 * days, pull-to-refresh, and full-page scroll — the intermittent "calendar got
 * stuck after I added an appointment" glitch.
 *
 * A single reference count removes that whole class: every overlay just asks for
 * the lock and releases its OWN handle; the background stays locked until the
 * LAST holder lets go, then reverts to the stylesheet default. No captured
 * values to get out of sync, and a release is idempotent so a double-cleanup
 * (StrictMode, fast open/close) can never drive the count negative.
 *
 * `body.style.overflow === "hidden"` stays the observable "locked" signal the
 * whole time (readers unchanged); this module is just its single writer.
 */

let count = 0;

const apply = () => {
  if (typeof document === "undefined") return;
  const b = document.body;
  const h = document.documentElement;
  b.style.overflow = "hidden";
  h.style.overflow = "hidden";
  b.style.overscrollBehavior = "none";
};

const clear = () => {
  if (typeof document === "undefined") return;
  const b = document.body;
  const h = document.documentElement;
  b.style.overflow = "";
  h.style.overflow = "";
  b.style.overscrollBehavior = "";
};

/**
 * Acquire the background scroll lock. Returns a release function; call it once
 * (typically from an effect's cleanup). Calling it more than once is a no-op, so
 * it's safe against StrictMode double-invoke and rapid open/close.
 */
export function lockScroll(): () => void {
  count += 1;
  if (count === 1) apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) clear();
  };
}

/**
 * Force-release every outstanding lock and clear the styles. A safety valve for
 * recovering from an impossible-but-catastrophic desync; not used in the normal
 * open/close path.
 */
export function forceUnlockScroll() {
  count = 0;
  clear();
}
