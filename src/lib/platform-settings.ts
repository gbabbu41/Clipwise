// Server-only — reads the single-row platform_settings table. Never import in a
// "use client" component (pulls in supabase-admin / the service-role key).
// Degrades to safe defaults if the table doesn't exist yet (pre-migration) so
// nothing ever breaks before phase27 runs.
import { supabaseAdmin } from "./supabase-admin";
import { DEFAULT_CARD_FEE_ESTIMATE } from "./revenue";

export interface PlatformSettings {
  platform_name: string;
  support_email: string;
  /** When false, the public signup page refuses new sign-ups. */
  signups_enabled: boolean;
  /** When true, dashboards show a maintenance banner. */
  maintenance_mode: boolean;
  maintenance_message: string;
  /** When true, a new free/unpaid shop is auto-approved instead of queued. */
  auto_approve_shops: boolean;
  /** ESTIMATE ONLY — % used to estimate a card fee Stripe hasn't confirmed yet.
   * Never applied to confirmed Stripe fees or to any customer charge. */
  est_card_fee_percent: number;
  /** ESTIMATE ONLY — fixed $ per card payment for the same fallback estimate. */
  est_card_fee_fixed: number;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  platform_name: "ClipWise",
  support_email: "support@clipwise.ca",
  signups_enabled: true,
  maintenance_mode: false,
  maintenance_message: "",
  auto_approve_shops: false,
  est_card_fee_percent: DEFAULT_CARD_FEE_ESTIMATE.percent,
  est_card_fee_fixed: DEFAULT_CARD_FEE_ESTIMATE.fixed,
};

// Keys a PUT is allowed to change, split by type for whitelisting.
export const SETTINGS_STRING_KEYS = ["platform_name", "support_email", "maintenance_message"] as const;
export const SETTINGS_BOOL_KEYS = ["signups_enabled", "maintenance_mode", "auto_approve_shops"] as const;
// Numeric keys with their allowed range (inclusive). Out-of-range or non-numeric
// values are rejected by the PUT, never clamped silently.
export const SETTINGS_NUMBER_KEYS = {
  est_card_fee_percent: { min: 0, max: 10 },
  est_card_fee_fixed: { min: 0, max: 2 },
} as const;

/** The fallback card-fee estimate rate, validated (a malformed stored value
 * falls back to the default rather than producing a nonsense estimate). */
export function cardFeeEstimateRate(s: PlatformSettings): { percent: number; fixed: number } {
  const pick = (k: keyof typeof SETTINGS_NUMBER_KEYS) => {
    const v = s[k], { min, max } = SETTINGS_NUMBER_KEYS[k];
    return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : DEFAULT_PLATFORM_SETTINGS[k];
  };
  return { percent: pick("est_card_fee_percent"), fixed: pick("est_card_fee_fixed") };
}

let cache: { value: PlatformSettings; at: number } | null = null;
const TTL_MS = 30_000;

export async function getPlatformSettings(force = false): Promise<PlatformSettings> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const { data, error } = await supabaseAdmin
      .from("platform_settings").select("data").eq("id", 1).maybeSingle();
    if (error) throw error;
    const merged: PlatformSettings = { ...DEFAULT_PLATFORM_SETTINGS, ...((data?.data ?? {}) as Partial<PlatformSettings>) };
    cache = { value: merged, at: Date.now() };
    return merged;
  } catch {
    // Pre-migration or a transient failure — safe defaults, and don't cache so
    // the next call self-heals once the table exists.
    return DEFAULT_PLATFORM_SETTINGS;
  }
}

export function invalidatePlatformSettingsCache() { cache = null; }
