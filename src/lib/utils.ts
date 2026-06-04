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
  // Bootstrap 4 colored badge variants. Combine with `badge badge-pill`
  // at the callsite — e.g. <span className={cn("badge badge-pill",
  // getStatusColor(s))}>. Visual semantics:
  //   confirmed → success (green)
  //   pending   → warning (amber)
  //   completed → primary (blue)
  //   cancelled → danger  (red)
  //   no-show   → danger  (red)
  const map: Record<string, string> = {
    confirmed: "badge-success",
    pending:   "badge-warning",
    completed: "badge-primary",
    cancelled: "badge-danger",
    "no-show": "badge-danger",
  };
  return map[status] ?? "badge-secondary";
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
export function generate24hSlots(): string[] {
  const slots: string[] = [];
  for (let totalMin = 0; totalMin < 24 * 60; totalMin += 30) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const period = h < 12 ? "AM" : "PM";
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    slots.push(`${displayHour}:${m.toString().padStart(2, "0")} ${period}`);
  }
  return slots;
}

/** Convert display time "9:00 AM" → minutes since midnight (for comparison) */
export function timeToMinutes(display: string): number {
  const [timePart, period] = display.split(" ");
  const [h, m] = timePart.split(":").map(Number);
  let hours = h;
  if (period === "AM" && h === 12) hours = 0;
  if (period === "PM" && h !== 12) hours = h + 12;
  return hours * 60 + m;
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
  bookedSlots: string[] = []
): { slot: string; available: boolean }[] {
  const SLOT_MINUTES = 30;
  const startMins = timeToMinutes(dbTimeToDisplay(startTimeDb));
  const endMins = timeToMinutes(dbTimeToDisplay(endTimeDb));
  const isToday = formatDateForDb(forDate) === formatDateForDb(new Date());
  const booked = new Set(bookedSlots);

  return generate24hSlots()
    .filter((slot) => {
      const m = timeToMinutes(slot);
      // A slot must START at or after the barber's start time AND
      // its 30-min window must END at or before the barber's end time.
      // Without the second check, a barber ending at 4:45 PM would still
      // offer a 4:30 PM slot — whose 30-min appointment ends at 5:00 PM,
      // 15 minutes past the barber's stated hours.
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
