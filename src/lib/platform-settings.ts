// Server-only — reads the single-row platform_settings table. Never import in a
// "use client" component (pulls in supabase-admin / the service-role key).
// Degrades to safe defaults if the table doesn't exist yet (pre-migration) so
// nothing ever breaks before phase27 runs.
import { supabaseAdmin } from "./supabase-admin";

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
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  platform_name: "ClipWise",
  support_email: "support@clipwise.ca",
  signups_enabled: true,
  maintenance_mode: false,
  maintenance_message: "",
  auto_approve_shops: false,
};

// Keys a PUT is allowed to change, split by type for whitelisting.
export const SETTINGS_STRING_KEYS = ["platform_name", "support_email", "maintenance_message"] as const;
export const SETTINGS_BOOL_KEYS = ["signups_enabled", "maintenance_mode", "auto_approve_shops"] as const;

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
