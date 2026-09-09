import { NO_SHOW_DEFAULT_PCT } from "@/lib/validation";

// Canonical default booking policy for a NEW shop.
//
// This MUST mirror DEFAULT_BOOKING in the Settings page
// (src/app/dashboard/settings/page.tsx) key-for-key, because the Settings screen
// merges DEFAULT_BOOKING over whatever is stored — so any behavioral key we DON'T
// persist here shows as its default in the UI while the booking page (which reads
// the raw stored value) sees it as absent. That drift is exactly what silently
// disabled online payments for brand-new paid shops: no_show_protection was never
// written, so `!!settings.no_show_protection` was false, so `canPayOnlineNow`
// (which requires it) was false — the Settings toggle showed ON, but customers
// could never pay online. Persisting the full object keeps the DB the single
// source of truth: what the owner sees is what actually happens.
//
// Notes on the two "off/quiet" defaults:
//   • loyalty starts OFF — the owner turns it on + sets the rate in Loyalty
//     settings (a null/absent config is treated as on-by-default only for legacy
//     shops; new shops get an explicit off so nothing points accrues silently).
//   • the day-before (24h) reminder starts ON — it cuts no-shows and costs
//     nothing (email on every plan; SMS only fires on paid plans). The same-day
//     (4h) reminder follows the reminders block and auto-activates once the cron
//     runs frequently enough (Pro / external schedule) — no redeploy needed.
export const DEFAULT_BOOKING_SETTINGS = {
  advance_days: 15,
  cancellation_hours: 2,
  no_show_protection: true,
  no_show_fee_percent: NO_SHOW_DEFAULT_PCT,
  pin_requires_card: true,
  auto_confirm: false,
  slot_interval_minutes: 30,
  tips_enabled: true,
  loyalty: { enabled: false },
  reminders: { appointment_24h: true },
};
