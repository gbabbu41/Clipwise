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

/** Shift a YYYY-MM-DD calendar date by N days (pure date math — DST-safe). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
