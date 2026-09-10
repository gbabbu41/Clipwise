import { supabaseAdmin } from "@/lib/supabase-admin";

// CASL consent — ONE model, ONE source of truth (see the phase58 migration).
// The PURE rules (canReceivePromos, clientIpFrom) live in ./consent-rules so
// client components can use them; this server-only module holds the DB writers
// and re-exports the rules so existing server imports keep working.
//
// Promotional consent is a TRI-STATE, because "never asked" and "opted out" are
// legally different:
//   • 'granted'   → express opt-in (they ticked the box). promo_consent_at / _ip /
//                   _source are the proof of when + where it was given.
//   • 'withdrawn' → they said STOP / unsubscribed. A HARD, PERMANENT block
//                   (promo_withdrawn_at), overriding even implied consent.
//   • null        → never asked. No express consent, but an existing business
//                   relationship (a visit within 24 months) is implied consent.
// Transactional reminders are a SEPARATE preference (sms_reminder_consent +
// sms_reminder_consent_at), defaulting on because they ride on the booking.

export { canReceivePromos, clientIpFrom } from "@/lib/consent-rules";
export type { PromoEligibility } from "@/lib/consent-rules";

/**
 * Record the customer's consent choices at booking time. Best-effort — consent
 * bookkeeping must NEVER block or fail a booking.
 *
 * Promotional consent is only ever UPGRADED here: ticking the box records express
 * 'granted' consent (with its proof). An UNticked box is "not now", NOT a
 * withdrawal — withdrawal is only ever explicit (STOP / unsubscribe), so we never
 * downgrade an existing 'granted' or 'withdrawn' from a blank booking box.
 * The reminder preference follows its checkbox both ways.
 */
export async function recordBookingConsent(args: {
  shopId: string;
  clientId?: string | null;
  email?: string | null;
  phone?: string | null;
  smsReminderConsent?: boolean;
  promoConsent?: boolean;
  ip?: string | null;
  source?: string;
}): Promise<void> {
  if (args.smsReminderConsent === undefined && args.promoConsent !== true) return;
  try {
    let clientId = (args.clientId ?? "").trim();
    if (!clientId) {
      const email = (args.email ?? "").trim();
      const phone = (args.phone ?? "").trim();
      if (email) {
        const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", args.shopId).ilike("email", email).maybeSingle();
        clientId = data?.id ?? "";
      }
      if (!clientId && phone) {
        const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", args.shopId).eq("phone", phone).maybeSingle();
        clientId = data?.id ?? "";
      }
    }
    if (!clientId) return;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    if (args.smsReminderConsent !== undefined) {
      patch.sms_reminder_consent = !!args.smsReminderConsent;
      patch.sms_reminder_consent_at = now;
    }
    if (args.promoConsent === true) {
      patch.promo_consent_status = "granted";
      patch.promo_consent_at = now;
      if (args.ip) patch.promo_consent_ip = String(args.ip).slice(0, 60);
      patch.promo_consent_source = args.source ?? "booking_form";
    }
    if (Object.keys(patch).length === 0) return;
    // If the consent columns haven't been migrated on prod yet, the update errors
    // on the missing column — swallow it (best-effort) rather than fail anything.
    await supabaseAdmin.from("clients").update(patch).eq("id", clientId).then(null, () => null);
  } catch { /* consent is best-effort — never block a booking */ }
}

/** Withdraw promotional consent (a STOP text or an email unsubscribe) — a
 *  permanent hard block. `alsoStopReminderSms` is set for an SMS STOP (the whole
 *  number is silenced at the carrier level), not for an email unsubscribe. */
export async function withdrawPromoConsent(clientIds: string[], opts?: { alsoStopReminderSms?: boolean }): Promise<void> {
  if (!clientIds.length) return;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { promo_consent_status: "withdrawn", promo_withdrawn_at: now };
  if (opts?.alsoStopReminderSms) { patch.sms_reminder_consent = false; patch.sms_reminder_consent_at = now; }
  await supabaseAdmin.from("clients").update(patch).in("id", clientIds).then(null, () => null);
}

/** Re-opt-in (a START text) — an affirmative request to receive messages again,
 *  so it records fresh express 'granted' consent and re-enables reminder texts. */
export async function regrantPromoConsent(clientIds: string[], source = "sms_start"): Promise<void> {
  if (!clientIds.length) return;
  const now = new Date().toISOString();
  await supabaseAdmin.from("clients").update({
    promo_consent_status: "granted", promo_consent_at: now, promo_consent_source: source,
    promo_withdrawn_at: null, sms_reminder_consent: true, sms_reminder_consent_at: now,
  }).in("id", clientIds).then(null, () => null);
}
