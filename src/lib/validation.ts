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
  return slotToMinutes(slot) <= nowMinutes;
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

export type PlanFeature = "payments" | "loyalty" | "pos" | "inventory" | "staff_portal" | "commission";

export const ALL_PLAN_FEATURES: PlanFeature[] = ["payments", "loyalty", "pos", "inventory", "staff_portal", "commission"];

export interface PlanConfigEntry {
  barberLimit: number; // Infinity = unlimited
  features: PlanFeature[];
}

const DEFAULT_PLAN_CONFIG: Record<string, PlanConfigEntry> = {
  starter: { barberLimit: 1, features: [] },
  pro: { barberLimit: 4, features: ["payments", "loyalty"] },
  premium: { barberLimit: 9, features: ["payments", "loyalty", "pos", "inventory", "staff_portal", "commission"] },
  business: { barberLimit: Infinity, features: ["payments", "loyalty", "pos", "inventory", "staff_portal", "commission"] },
};

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

export function planHasFeature(plan: string | undefined, feature: PlanFeature): boolean {
  const key = plan ?? "starter";
  return (planConfig[key]?.features ?? DEFAULT_PLAN_CONFIG[key]?.features ?? []).includes(feature);
}

// A subscription that is cancelled/past_due/inactive means the shop falls back to starter
export function effectivePlan(plan: string | undefined, subscriptionStatus: string | undefined): string {
  if (plan === "starter" || !plan) return "starter";
  if (subscriptionStatus === "active") return plan;
  return "starter"; // expired/cancelled/past_due → downgrade
}
