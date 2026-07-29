// Shop-timezone helpers. Server code runs in UTC on Vercel, so any "is this
// today / is this slot in the past" decision made server-side must be evaluated
// in the SHOP's timezone, not UTC. These use the built-in Intl API (no deps) and
// work identically in Node and the browser.

export const DEFAULT_TZ = "America/Toronto";

// Canadian zones for the shop-settings picker (label → IANA value).
export const CANADA_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/St_Johns", label: "Newfoundland (NL)" },
  { value: "America/Halifax", label: "Atlantic (NB, NS, PEI)" },
  { value: "America/Toronto", label: "Eastern (ON, QC)" },
  { value: "America/Winnipeg", label: "Central (MB, SK)" },
  { value: "America/Edmonton", label: "Mountain (AB)" },
  { value: "America/Vancouver", label: "Pacific (BC, YT)" },
];

const KNOWN = new Set(CANADA_TIMEZONES.map((t) => t.value));

/** Normalize/validate an IANA tz string, falling back to the default. */
export function safeTz(tz: string | null | undefined): string {
  return tz && KNOWN.has(tz) ? tz : DEFAULT_TZ;
}

/** Today's calendar date (YYYY-MM-DD) in the given timezone. */
export function todayInTz(tz: string = DEFAULT_TZ): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Minutes-since-midnight of "now" in the given timezone (0–1439). */
export function nowMinutesInTz(tz: string = DEFAULT_TZ): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  let h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (h === 24) h = 0; // some engines emit "24" for midnight
  return h * 60 + m;
}

/**
 * THE past-booking guard: is a booking for `date` (YYYY-MM-DD) at `timeSlot`
 * ("9:00 AM") in the past, judged in the SHOP's timezone (never the server's UTC)?
 * Used by every server booking/reschedule path so NO ONE — customer or staff —
 * can ever book a slot that's already passed. A booking exactly at "now" is
 * allowed; only strictly-earlier is blocked. Unparseable/missing slot on today's
 * date → not treated as past (fail open on the minute check, the date already
 * passed the day check).
 */
export function isBookingInPast(date: string, timeSlot: string | null | undefined, tz: string | null | undefined): boolean {
  const zone = safeTz(tz);
  const today = todayInTz(zone);
  if (date < today) return true;   // an earlier calendar day (string compare is valid for YYYY-MM-DD)
  if (date > today) return false;  // a future day
  if (!timeSlot) return false;     // same day, no time to compare
  const slotMin = timeToMinutesLocal(timeSlot);
  if (slotMin === null) return false;
  return slotMin < nowMinutesInTz(zone);
}

// Local minutes-from-midnight parser for "9:00 AM" / "12:30 PM" (kept here to
// avoid an import cycle risk; mirrors utils.timeToMinutes).
function timeToMinutesLocal(slot: string): number | null {
  const m = slot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const pm = m[3].toUpperCase() === "PM";
  if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12;
  return h * 60 + min;
}

/** Shift a YYYY-MM-DD calendar date by N days (pure date math — DST-safe). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
