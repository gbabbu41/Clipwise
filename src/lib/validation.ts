// Shared validation utilities — used across ClipWise forms

// ── Phone ─────────────────────────────────────────────────────────────────────

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function validatePhone(value: string): string | null {
  if (!value) return null; // optional field — only validate if provided
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return "Please enter a valid 10-digit phone number (e.g. 506-555-0123)";
  return null;
}

// ── Email ─────────────────────────────────────────────────────────────────────

export function validateEmail(value: string): string | null {
  if (!value) return "Email is required";
  if (value.includes(" ")) return "Email cannot contain spaces";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Please enter a valid email address";
  return null;
}

// ── Length caps ───────────────────────────────────────────────────────────────
// These mirror the DB CHECK constraints (migration length_caps_*). Clamp public
// free-text server-side BEFORE insert so an oversized value truncates cleanly
// instead of hitting the constraint and 500-ing a booking. The DB check is the
// backstop; this is the friendly front line.
export const FIELD_CAPS = {
  client_name: 500,
  client_email: 320,
  client_phone: 50,
  notes: 2000,
  shop_description: 500,
} as const;

/** Trim a string to `max` chars (null-safe). Returns null for null/undefined. */
export function clampLen<T extends string | null | undefined>(v: T, max: number): string | null {
  if (v == null) return null;
  return v.length > max ? v.slice(0, max) : v;
}

// ── Price ─────────────────────────────────────────────────────────────────────

export function validatePrice(value: string | number): string | null {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n) || n <= 0) return "Price must be greater than $0";
  if (n > 500) return "Price cannot exceed $500";
  return null;
}

// ── Duration ──────────────────────────────────────────────────────────────────

export function validateDuration(value: string | number): string | null {
  const n = typeof value === "string" ? parseInt(value) : value;
  if (isNaN(n) || n < 15) return "Service duration must be at least 15 minutes";
  if (n > 480) return "Service duration cannot exceed 8 hours (480 min)";
  return null;
}

// ── Password ──────────────────────────────────────────────────────────────────

export interface PasswordStrength {
  strength: "weak" | "medium" | "strong";
  score: number; // 0-3
  issues: string[];
}

export function getPasswordStrength(password: string): PasswordStrength {
  const issues: string[] = [];
  if (password.length < 8) issues.push("At least 8 characters");
  if (!/[A-Z]/.test(password)) issues.push("At least 1 capital letter");
  if (!/[0-9]/.test(password)) issues.push("At least 1 number");
  const score = 3 - issues.length;
  return {
    score,
    issues,
    strength: score === 3 ? "strong" : score === 2 ? "medium" : "weak",
  };
}

// ── Dates ─────────────────────────────────────────────────────────────────────

export function isWithin6Months(date: Date): boolean {
  const sixMonths = new Date();
  sixMonths.setMonth(sixMonths.getMonth() + 6);
  return date <= sixMonths;
}

// Convert "9:00 AM" style slot to minutes since midnight
export function slotToMinutes(slot: string): number {
  const [time, period] = slot.split(" ");
  const [h, m] = time.split(":").map(Number);
  let hours = h;
  if (period === "PM" && h !== 12) hours += 12;
  if (period === "AM" && h === 12) hours = 0;
  return hours * 60 + m;
}

export function isSlotInPast(slot: string): boolean {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Strictly-less-than so the currently-active slot stays bookable.
  return slotToMinutes(slot) < nowMinutes;
}

// Convert "HH:MM" (24h) to minutes — for settings hours comparison
export function time24ToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── Plan config (DB-driven with safe defaults) ──────────────────────────────────
// Plans live in the `plans` table and are edited by the super_admin. The funcs
// below stay SYNC (they're called in render paths + many API routes) and read
// from an in-memory config that is hydrated from the DB:
//   • client → AuthProvider fetches /api/plans on mount and calls hydratePlanConfig
//   • server → gating routes call ensurePlansHydrated() (lib/plans-server) first
// Until hydrated (or if a fetch fails) we fall back to these defaults, which
// mirror the historical hardcoded tiers — so gating is always safe, never open.

export type PlanFeature = "payments" | "loyalty" | "pos" | "inventory" | "staff_portal" | "commission" | "multi_location";

export const ALL_PLAN_FEATURES: PlanFeature[] = ["payments", "loyalty", "pos", "inventory", "staff_portal", "commission", "multi_location"];

export interface PlanConfigEntry {
  barberLimit: number; // Infinity = unlimited
  features: PlanFeature[];
  locationLimit?: number; // max shops/locations; undefined → falls back to default
}

const DEFAULT_PLAN_CONFIG: Record<string, PlanConfigEntry> = {
  starter: { barberLimit: 1, features: [], locationLimit: 1 },
  pro: { barberLimit: 4, features: ["payments", "loyalty"], locationLimit: 1 },
  // Premium: 2 locations included ($79). A 3rd+ is a $30/mo add-on, up to MAX.
  premium: { barberLimit: 9, features: ["payments", "loyalty", "pos", "inventory", "staff_portal", "commission", "multi_location"], locationLimit: 2 },
  business: { barberLimit: Infinity, features: ["payments", "loyalty", "pos", "inventory", "staff_portal", "commission", "multi_location"], locationLimit: 5 },
};

// Absolute hard ceiling on locations for ANY plan/owner — no subscription can
// exceed this (Premium's 2 included + future $30 add-ons still top out here).
export const MAX_LOCATIONS = 5;

let planConfig: Record<string, PlanConfigEntry> = { ...DEFAULT_PLAN_CONFIG };

/** Overwrite the live plan config from DB rows. Empty/falsy input is ignored so
 *  a bad fetch never wipes gating down to "no features". DB plans are merged
 *  over defaults so a tier missing from the DB still resolves safely. */
export function hydratePlanConfig(entries: Record<string, PlanConfigEntry> | null | undefined) {
  if (!entries || Object.keys(entries).length === 0) return;
  planConfig = { ...DEFAULT_PLAN_CONFIG, ...entries };
}

export function getPlanLimit(plan: string): number {
  return planConfig[plan]?.barberLimit ?? DEFAULT_PLAN_CONFIG[plan]?.barberLimit ?? 1;
}

// Max locations (shops) a plan allows, clamped to the global MAX_LOCATIONS. DB-
// hydrated plans have no location_limit column yet, so this falls back to the
// defaults above (premium = 2).
export function getLocationLimit(plan: string | undefined): number {
  const key = plan ?? "starter";
  const raw = planConfig[key]?.locationLimit ?? DEFAULT_PLAN_CONFIG[key]?.locationLimit ?? 1;
  return Math.min(raw, MAX_LOCATIONS);
}

export function planHasFeature(plan: string | undefined, feature: PlanFeature): boolean {
  const key = plan ?? "starter";
  return (planConfig[key]?.features ?? DEFAULT_PLAN_CONFIG[key]?.features ?? []).includes(feature);
}

/**
 * Is this a PAID plan (anything above the free Starter tier)? Gates the extras
 * that free shops don't get but that aren't tied to a specific feature flag:
 * customer SMS, reviews, marketing, analytics, walk-in/waitlist. Free = book +
 * basic customer emails only. Pass an already-resolved `effectivePlan(...)` so an
 * expired/cancelled paid plan (which downgrades to starter) is correctly treated
 * as free.
 */
export function isPaidPlan(plan: string | undefined): boolean {
  return (plan ?? "starter") !== "starter";
}

// A subscription that is cancelled/past_due/inactive means the shop falls back to starter
export function effectivePlan(plan: string | undefined, subscriptionStatus: string | undefined): string {
  if (plan === "starter" || !plan) return "starter";
  if (subscriptionStatus === "active") return plan;
  return "starter"; // expired/cancelled/past_due → downgrade
}

// ── No-show fee ──────────────────────────────────────────────────────────────
// The no-show fee is a PERCENTAGE of the booked total, chosen per-appointment by
// the barber/owner at the moment they mark the no-show (a 0–100% slider), and
// defaulting to the shop's configured percentage. Fees are never auto-charged;
// a barber (or the owner) triggers them manually.
export const NO_SHOW_MAX_PCT = 100;
export const NO_SHOW_DEFAULT_PCT = 50;
// How long BEFORE the appointment start the "No-show" action becomes available,
// judged in the shop's timezone (owner asked for a 1-hour lead). Once the slot's
// start is within this window (or has passed) the barber can mark a no-show.
export const NO_SHOW_LEAD_MINUTES = 60;
// (Retained for back-compat; no longer gates the no-show action.)
export const NO_SHOW_GRACE_MINUTES = 15;

/** Clamp a no-show percentage into the allowed 0–100 range. */
export function clampNoShowPct(pct: number | undefined | null): number {
  return Math.min(Math.max(Math.round(pct ?? NO_SHOW_DEFAULT_PCT), 0), NO_SHOW_MAX_PCT);
}

/** Dollar no-show fee for a booked total at the given percentage (0–100),
 *  rounded to cents. */
export function noShowFeeDollars(total: number, pct: number | undefined | null): number {
  return Math.round((total ?? 0) * clampNoShowPct(pct)) / 100;
}

/** Cent-precise no-show fee for Stripe, from a total already in cents. */
export function noShowFeeCents(totalCents: number, pct: number | undefined | null): number {
  return Math.round((totalCents ?? 0) * clampNoShowPct(pct) / 100);
}
