import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getStatusColor(status: string): string {
  // Monochrome pills — the card holds at most one colored element (the
  // green price). Statuses differentiate by LABEL, not hue. Active/upcoming
  // states get full-white text; finished/inactive states drop to grey.
  const ACTIVE = "bg-[#1a1a1a] text-white";
  const MUTED  = "bg-[#1a1a1a] text-[#888]";
  const map: Record<string, string> = {
    confirmed: ACTIVE,
    pending:   ACTIVE,
    completed: MUTED,
    cancelled: MUTED,
    "no-show": MUTED,
  };
  return map[status] ?? MUTED;
}

/**
 * Payment-state tag for an appointment — returns coloured text segments for a
 * small, clean pill used on the dashboards' Today's Schedule. Colours match
 * the Payments page, and the pill is two-toned: "Paid" is always green, while
 * the method word carries its own colour (Cash → amber, Card → green).
 *  • Paid · Card → green · green   • Paid · Cash → green · amber (cash colour)
 *  • Awaiting payment (a checkout link was emailed/texted) → sky
 *  • Unpaid (payment due, no link sent) → amber
 *  • Refunded / cancelled / no-show → muted grey
 */
export function paymentTag(a: {
  payment_status?: string | null;
  payment_method?: string | null;
  status?: string | null;
  stripe_checkout_session_id?: string | null;
}): { bg: string; segments: { text: string; className: string }[] } {
  const GREEN = "text-[#00e5a0]";
  const AMBER = "text-amber-400";
  const SKY = "text-sky-400";
  const MUTED = "text-[#888]";
  const bg = "bg-white/[0.06]";
  const paid = a.payment_status === "paid" || a.payment_status === "captured";
  if (paid) {
    const cash = a.payment_method === "cash";
    const methodText = cash ? "Cash" : a.payment_method === "online" ? "Online" : "Card";
    return { bg, segments: [
      { text: "Paid", className: GREEN },
      { text: methodText, className: cash ? AMBER : GREEN },
    ] };
  }
  if (a.payment_status === "refunded") return { bg, segments: [{ text: "Refunded", className: MUTED }] };
  if (a.status === "no-show") return { bg, segments: [{ text: "No-show", className: MUTED }] };
  if (a.status === "cancelled") return { bg, segments: [{ text: "Cancelled", className: MUTED }] };
  // Unpaid: a sent checkout link means we're waiting on the customer;
  // otherwise the payment is simply still due.
  if (a.stripe_checkout_session_id) return { bg, segments: [{ text: "Awaiting payment", className: SKY }] };
  return { bg, segments: [{ text: "Unpaid", className: AMBER }] };
}

export function getTagColor(tag: string): string {
  const map: Record<string, string> = {
    VIP: "text-orange-400 bg-orange-500/20 border-orange-500/30",
    New: "text-emerald-400 bg-emerald-500/20 border-emerald-500/30",
    Returning: "text-blue-400 bg-blue-500/20 border-blue-500/30",
    "At Risk": "text-red-400 bg-red-500/20 border-red-500/30",
  };
  return map[tag] ?? "text-[#777] bg-gray-500/20 border-gray-500/30";
}

// ─── Time Utilities ────────────────────────────────────────────────────────────

/** Generate all 30-minute slots for a full 24-hour day */
export function generate24hSlots(intervalMin = 30): string[] {
  const step = intervalMin > 0 ? intervalMin : 30;
  const slots: string[] = [];
  for (let totalMin = 0; totalMin < 24 * 60; totalMin += step) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const period = h < 12 ? "AM" : "PM";
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    slots.push(`${displayHour}:${m.toString().padStart(2, "0")} ${period}`);
  }
  return slots;
}

/** Every start-slot a booking occupies, given its start slot and the service
 *  duration in minutes. A slot is occupied when it falls inside the half-open
 *  span [start, start+duration) — so a 45-min booking at "9:00 AM" blocks
 *  9:00/9:30 on a 30-min grid (and 9:00/9:15/9:30, freeing 9:45, on a 15-min
 *  grid), but never the slot at exactly start+duration. Used to mark covered
 *  slots as booked (not just the start). */
export function occupiedSlots(startSlot: string, durationMin: number, intervalMin = 30): string[] {
  const startMin = timeToMinutes(startSlot);
  if (Number.isNaN(startMin)) return [startSlot];
  const endMin = startMin + (durationMin > 0 ? durationMin : intervalMin);
  return generate24hSlots(intervalMin).filter((s) => {
    const m = timeToMinutes(s);
    return m >= startMin && m < endMin;
  });
}

/** Convert display time "9:00 AM" → minutes since midnight (for comparison) */
export function timeToMinutes(display: string): number {
  if (!display) return 0;
  const [timePart, period] = display.split(" ");
  const [h, m] = timePart.split(":").map(Number);
  let hours = h;
  if (period === "AM" && h === 12) hours = 0;
  if (period === "PM" && h !== 12) hours = h + 12;
  return hours * 60 + (m || 0);
}

/** Convert display time "9:00 AM" → DB time "09:00:00" */
export function displayTimeToDb(display: string): string {
  const mins = timeToMinutes(display);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:00`;
}

/** Convert DB time "09:00:00" → display "9:00 AM" */
export function dbTimeToDisplay(dbTime: string): string {
  const [hStr, mStr] = dbTime.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h < 12 ? "AM" : "PM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Format a Date as "YYYY-MM-DD" for Supabase queries.
 *  Uses the Date's *local* year/month/day so May 31 stays May 31 even
 *  when UTC has already rolled to June 1 (i.e. evening in any timezone
 *  west of UTC). Using `.toISOString()` here would silently drift the
 *  whole app's "today" to tomorrow after roughly 8pm local time. */
export function formatDateForDb(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Context-aware short date label — single word/phrase, easy to scan.
 *
 *   -1 day  → "Yesterday"
 *    0 day  → "Today"
 *   +1 day  → "Tomorrow"
 *   ±6 days from today (excluding the three above) → weekday name
 *                                                    ("Monday", "Friday";
 *                                                    "Last Monday" for
 *                                                    past dates)
 *   beyond  → "June 27" (or "June 27, 2025" if a different year)
 */
export function friendlyDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  date.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diff === 0)  return "Today";
  if (diff === 1)  return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return date.toLocaleDateString("en-CA", { weekday: "long" });
  if (diff < -1 && diff > -7) return `Last ${date.toLocaleDateString("en-CA", { weekday: "long" })}`;
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Human-friendly date label (verbose):
 *   today      → "Today, June 3, 2026"
 *   tomorrow   → "Tomorrow, June 4, 2026"
 *   other date → "Tuesday, June 10, 2026"
 */
export function formatFriendlyDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  date.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const monthDay = date.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
  if (date.getTime() === today.getTime()) return `Today, ${monthDay}`;
  if (date.getTime() === tomorrow.getTime()) return `Tomorrow, ${monthDay}`;
  const weekday = date.toLocaleDateString("en-CA", { weekday: "long" });
  return `${weekday}, ${monthDay}`;
}

/**
 * Convert a stored time value ("HH:MM", "HH:MM:SS", "17:00", "17:00:00")
 * to a 12-hour display like "5:00 PM" / "9:00 AM" / "12:30 PM".
 * Returns "" for falsy input.
 */
export function formatFriendlyTime(t: string | null | undefined): string {
  if (!t) return "";
  const [hStr, mStr = "0"] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  const period = h < 12 ? "AM" : "PM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${period}`;
}

/**
 * Short relative-time label for a timestamp, e.g. "just now", "10 min ago",
 * "3 h ago", "yesterday", "Jun 3". Used for "Paid · 10 min ago" payment
 * labels. Returns "" for falsy / unparseable input.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 0) return "just now";
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.round(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/**
 * Pretty, human-readable date for emails / SMS / notifications / pop-ups.
 *   "2026-07-14" → "July 14"  (adds the year only when it isn't the current
 *                              year, e.g. "January 2, 2027").
 *
 * Timezone-safe for SERVER use: parses the date-only string at local midnight
 * and never applies Today/Tomorrow relativity, so a UTC server (Vercel) can't
 * mislabel a date near the day boundary — the reason the rest of the app avoids
 * `friendlyDate` in server-side emails/SMS.
 *
 * Idempotent: any input that isn't a plain "YYYY-MM-DD" date (already-formatted
 * strings, ranges, empty) is returned unchanged, so it's safe to apply at both
 * the producer and the email-route chokepoint without double-formatting.
 */
export function prettyDate(d: string | null | undefined): string {
  if (!d) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // already formatted / not a date-only string
  const date = new Date(d + "T00:00:00");
  if (Number.isNaN(date.getTime())) return d;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Like prettyDate, but prefixes a relative label (Today / Tomorrow / weekday)
 * so notifications, SMS and pop-ups carry day-context alongside the date.
 *
 *   today        → "Today · June 15"
 *   tomorrow     → "Tomorrow · June 16"
 *   within a week→ "Wednesday · June 17"  ("Last Wednesday · ..." in the past)
 *   beyond       → "June 27"  (unchanged from prettyDate)
 *
 * "Today" is computed in Eastern time (the app is Canadian, clipwise.ca) — not
 * the UTC server clock — so the Today/Tomorrow boundary matches a shop's real
 * day instead of flipping a day early during the hours UTC runs ahead of ET.
 * The day-count is done on UTC-midnight parses so DST never shifts it.
 */
export function prettyDateWithContext(d: string | null | undefined): string {
  const pretty = prettyDate(d);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !pretty) return pretty;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
  const diff = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  const weekday = new Date(d + "T00:00:00Z").toLocaleDateString("en-CA", { weekday: "long", timeZone: "UTC" });

  let prefix = "";
  if (diff === 0) prefix = "Today";
  else if (diff === 1) prefix = "Tomorrow";
  else if (diff === -1) prefix = "Yesterday";
  else if (diff > 1 && diff < 7) prefix = weekday;
  else if (diff < -1 && diff > -7) prefix = `Last ${weekday}`;

  return prefix ? `${prefix} · ${pretty}` : pretty;
}

/** True if the given date is strictly before today (local time) */
export function isDateInPast(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d < today;
}

/** True if the given display time slot is in the past (for today only) */
export function isSlotInPast(slot: string): boolean {
  const now = new Date();
  const slotMins = timeToMinutes(slot);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return slotMins <= nowMins;
}

/** Generate booking slots between a DB start_time and end_time on a given date */
export function getSlotsInRange(
  startTimeDb: string,
  endTimeDb: string,
  forDate: Date,
  bookedSlots: string[] = [],
  intervalMin = 30,
): { slot: string; available: boolean }[] {
  const SLOT_MINUTES = intervalMin > 0 ? intervalMin : 30;
  const startMins = timeToMinutes(dbTimeToDisplay(startTimeDb));
  const endMins = timeToMinutes(dbTimeToDisplay(endTimeDb));
  const isToday = formatDateForDb(forDate) === formatDateForDb(new Date());
  const booked = new Set(bookedSlots);

  return generate24hSlots(SLOT_MINUTES)
    .filter((slot) => {
      const m = timeToMinutes(slot);
      // A slot must START at or after the barber's start time AND its window
      // must END at or before the barber's end time. Without the second check,
      // a barber ending at 4:45 PM would still offer a slot whose appointment
      // runs past the barber's stated hours.
      return m >= startMins && m + SLOT_MINUTES <= endMins;
    })
    .map((slot) => ({
      slot,
      available:
        !booked.has(slot) && !(isToday && isSlotInPast(slot)),
    }));
}

// ─── Date Range Utilities ──────────────────────────────────────────────────────

export type DateFilterKey =
  | "today"
  | "this-week"
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "last-6-months"
  | "this-year"
  | "custom";

export const DATE_FILTER_LABELS: Record<DateFilterKey, string> = {
  "today": "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  "last-month": "Last Month",
  "last-3-months": "Last 3 Months",
  "last-6-months": "Last 6 Months",
  "this-year": "This Year",
  "custom": "Custom Range",
};

export function getDateRange(
  filter: DateFilterKey,
  customStart?: string,
  customEnd?: string
): [string, string] {
  const now = new Date();
  const today = formatDateForDb(now);

  const startOf = (d: Date) => { d.setHours(0, 0, 0, 0); return d; };

  switch (filter) {
    case "today":
      return [today, today];
    case "this-week": {
      const s = startOf(new Date(now));
      s.setDate(now.getDate() - now.getDay());
      return [formatDateForDb(s), today];
    }
    case "this-month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return [formatDateForDb(s), today];
    }
    case "last-month": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return [formatDateForDb(s), formatDateForDb(e)];
    }
    case "last-3-months": {
      const s = new Date(now);
      s.setMonth(now.getMonth() - 3);
      return [formatDateForDb(startOf(s)), today];
    }
    case "last-6-months": {
      const s = new Date(now);
      s.setMonth(now.getMonth() - 6);
      return [formatDateForDb(startOf(s)), today];
    }
    case "this-year": {
      const s = new Date(now.getFullYear(), 0, 1);
      return [formatDateForDb(s), today];
    }
    case "custom":
      return [customStart || today, customEnd || today];
    default:
      return [today, today];
  }
}
