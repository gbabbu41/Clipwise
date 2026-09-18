/** One initial positioning only. Never run a scroll animation or chase the clock. */
export function fullDayCalendarWindow(): { winStart: number; winEnd: number; hours: number[] } {
  // 00:00 inclusive to the next midnight exclusive: 24 complete hour rows.
  // Keep geometry independent of working hours, bookings and realtime reloads.
  return { winStart: 0, winEnd: 24, hours: Array.from({ length: 24 }, (_, hour) => hour) };
}

export function calendarFocusTop(target: number, viewport: number, content: number): number {
  return Math.max(0, Math.min(Math.max(0, content - viewport), target - viewport / 2));
}

export function calendarLandingHour(showsToday: boolean, currentHour: number, starts: number[]): number {
  if (showsToday) return Math.max(0, Math.min(24, currentHour));
  return Math.min(7, ...starts.filter(hour => Number.isFinite(hour) && hour >= 0 && hour < 24));
}

export function startCalendarAutofocus(el: HTMLElement, measure: () => number | null): () => void {
  let frame: number | null = null;
  let stopped = false;
  let previous = "";
  let stable = 0;
  const started = performance.now();
  const host = el.closest("[data-no-swipe]") ?? el;
  const events = ["touchstart", "touchmove", "pointerdown", "wheel", "keydown"];
  const stop = () => {
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    events.forEach(type => host.removeEventListener(type, stop, true));
    el.removeEventListener("scroll", stop);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", stop);
  };
  const onVisibility = () => { if (document.hidden) stop(); };
  events.forEach(type => host.addEventListener(type, stop, { capture: true, passive: true }));
  // Only the timeline's scroll counts: the date rail centres itself separately.
  el.addEventListener("scroll", stop, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", stop);
  const tick = () => {
    if (stopped) return;
    // A slow load is allowed to skip centering, never to surprise the user later.
    if (document.hidden || !el.isConnected || performance.now() - started > 5000) { stop(); return; }
    const target = measure();
    if (target !== null && Number.isFinite(target) && el.clientHeight > 0) {
      const rect = el.getBoundingClientRect();
      const geometry = [target, el.clientHeight, el.scrollHeight, rect.top, rect.left, rect.width, rect.height]
        .map(n => Math.round(n * 10) / 10).join(":");
      stable = geometry === previous ? stable + 1 : 0;
      previous = geometry;
      if (stable >= 2) {
        const top = calendarFocusTop(target, el.clientHeight, el.scrollHeight);
        // Stop BEFORE the write. No grace-period guessing about who scrolled,
        // no second pass, and no surviving listeners/timers to fight a finger.
        stop();
        if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
        return;
      }
    } else { stable = 0; previous = ""; }
    frame = requestAnimationFrame(tick);
  };
  if (document.hidden) stop();
  else frame = requestAnimationFrame(tick);
  return stop;
}
