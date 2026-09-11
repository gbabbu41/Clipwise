import { supabaseAdmin } from "@/lib/supabase-admin";

// CASL consent — ONE model, ONE source of truth (see phase58 + phase59 migrations).
// The PURE rules (canReceivePromos, clientIpFrom) live in ./consent-rules so
// client components can use them; this server-only module holds the DB writers
// and re-exports the rules so existing server imports keep working.
//
// Two layers, on purpose:
//   • clients.* columns  = the fast "can I send right now?" CURRENT state.
//       promo_consent_status: 'granted' (express) | 'withdrawn' (permanent hard
//       block) | null (never asked → implied-consent window may apply).
//       sms_reminder_opt_in = a PREFERENCE (defaults true; reminders ride on the
//       booked transaction), not a consent.
//   • consent_events      = an APPEND-ONLY audit trail — the permanent PROOF of
//       every grant/withdrawal (kind, granted, source, ip, when). This is what
//       survives a CRTC inquiry; the row columns get overwritten, the log doesn't.

import { isValidIp } from "@/lib/consent-rules";
import { normPhone } from "@/lib/client-identity";

export { canReceivePromos, clientIpFrom } from "@/lib/consent-rules";
export type { PromoEligibility } from "@/lib/consent-rules";

type ConsentEvent = {
  client_id: string;
  shop_id: string;
  kind: "reminder" | "promo";
  granted: boolean;
  source: string;
  ip?: string | null;
  user_agent?: string | null;
};

/** Append consent events to the immutable audit trail. Best-effort — proof
 *  logging must never block the action that triggered it. */
async function logConsentEvents(events: ConsentEvent[]): Promise<void> {
  if (!events.length) return;
  await supabaseAdmin.from("consent_events").insert(
    events.map(e => ({
      client_id: e.client_id, shop_id: e.shop_id, kind: e.kind, granted: e.granted,
      source: e.source, ip: isValidIp(e.ip) ? e.ip : null, user_agent: e.user_agent ? String(e.user_agent).slice(0, 400) : null,
    })),
  ).then(null, () => null);
}

/**
 * Record the customer's consent choices at booking time, on the row AND in the
 * audit log. Best-effort — consent bookkeeping must NEVER block or fail a booking.
 *
 * Promotional consent is only ever UPGRADED here, and only from a non-withdrawn
 * state: ticking the box records express 'granted' consent (with its proof). An
 * UNticked box is "not now", NOT a withdrawal. And a prior 'withdrawn' (a STOP /
 * unsubscribe) is DURABLE — a booking checkbox can't resurrect it; only an
 * explicit re-opt-in (START) can. So a blank box never downgrades, and a ticked
 * box never overrides a withdrawal. The reminder preference follows its checkbox.
 */
export async function recordBookingConsent(args: {
  shopId: string;
  clientId?: string | null;
  email?: string | null;
  phone?: string | null;
  smsReminderConsent?: boolean;
  promoConsent?: boolean;
  ip?: string | null;
  userAgent?: string | null;
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
      const np = normPhone(phone);
      if (!clientId && np) {
        const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", args.shopId).eq("phone_normalized", np).limit(1);
        clientId = data?.[0]?.id ?? "";
      }
    }
    if (!clientId) return;
    const now = new Date().toISOString();
    const source = args.source ?? "booking_form";
    const patch: Record<string, unknown> = {};
    const events: ConsentEvent[] = [];
    if (args.smsReminderConsent !== undefined) {
      patch.sms_reminder_opt_in = !!args.smsReminderConsent;
      patch.sms_reminder_opt_in_at = now;
      events.push({ client_id: clientId, shop_id: args.shopId, kind: "reminder", granted: !!args.smsReminderConsent, source, ip: args.ip, user_agent: args.userAgent });
    }
    if (args.promoConsent === true) {
      // A prior STOP / unsubscribe is a DURABLE block: a booking-form checkbox can
      // never resurrect it — only an explicit re-opt-in (texting START) can. So
      // only grant when the client hasn't withdrawn. (The box is unchecked by
      // default, so this read only happens when someone actively ticks it.)
      const { data: cur } = await supabaseAdmin
        .from("clients").select("promo_consent_status").eq("id", clientId).maybeSingle();
      if (cur?.promo_consent_status !== "withdrawn") {
        patch.promo_consent_status = "granted";
        patch.promo_consent_at = now;
        if (isValidIp(args.ip)) patch.promo_consent_ip = args.ip;
        patch.promo_consent_source = source;
        events.push({ client_id: clientId, shop_id: args.shopId, kind: "promo", granted: true, source, ip: args.ip, user_agent: args.userAgent });
      }
    }
    if (Object.keys(patch).length === 0) return;
    // If the consent columns haven't been migrated on prod yet, the update errors
    // on the missing column — swallow it (best-effort) rather than fail anything.
    await supabaseAdmin.from("clients").update(patch).eq("id", clientId).then(null, () => null);
    await logConsentEvents(events);
  } catch { /* consent is best-effort — never block a booking */ }
}

/** Withdraw promotional consent (a STOP text or an email unsubscribe) — a
 *  permanent hard block, logged to the audit trail. `alsoStopReminderSms` is set
 *  for an SMS STOP (the whole number is silenced at the carrier level), not for an
 *  email unsubscribe (which shouldn't kill transactional reminders). */
export async function withdrawPromoConsent(clientIds: string[], opts?: { source?: string; alsoStopReminderSms?: boolean }): Promise<void> {
  if (!clientIds.length) return;
  const source = opts?.source ?? "email_unsubscribe";
  const now = new Date().toISOString();
  // Fetch shop_id per client so each event is attributed to the right sender.
  const { data: rows } = await supabaseAdmin.from("clients").select("id, shop_id").in("id", clientIds);
  if (!rows?.length) return;
  const patch: Record<string, unknown> = { promo_consent_status: "withdrawn", promo_withdrawn_at: now };
  // An SMS STOP is a carrier-level block on ALL texts — stamp the durable marker
  // (never cleared except by an explicit START) and turn off the reminder pref.
  if (opts?.alsoStopReminderSms) { patch.sms_reminder_opt_in = false; patch.sms_reminder_opt_in_at = now; patch.sms_opted_out_at = now; }
  await supabaseAdmin.from("clients").update(patch).in("id", clientIds).then(null, () => null);
  const events: ConsentEvent[] = [];
  for (const r of rows) {
    events.push({ client_id: r.id, shop_id: r.shop_id, kind: "promo", granted: false, source });
    if (opts?.alsoStopReminderSms) events.push({ client_id: r.id, shop_id: r.shop_id, kind: "reminder", granted: false, source });
  }
  await logConsentEvents(events);
}

/** Re-opt-in (a START text) — an affirmative request to receive messages again,
 *  so it records fresh express 'granted' consent + re-enables reminders, logged. */
export async function regrantPromoConsent(clientIds: string[], source = "sms_start"): Promise<void> {
  if (!clientIds.length) return;
  const now = new Date().toISOString();
  const { data: rows } = await supabaseAdmin.from("clients").select("id, shop_id").in("id", clientIds);
  if (!rows?.length) return;
  await supabaseAdmin.from("clients").update({
    promo_consent_status: "granted", promo_consent_at: now, promo_consent_source: source,
    promo_withdrawn_at: null, sms_reminder_opt_in: true, sms_reminder_opt_in_at: now,
    sms_opted_out_at: null, // explicit re-opt-in clears the durable SMS block
  }).in("id", clientIds).then(null, () => null);
  const events: ConsentEvent[] = [];
  for (const r of rows) {
    events.push({ client_id: r.id, shop_id: r.shop_id, kind: "promo", granted: true, source });
    events.push({ client_id: r.id, shop_id: r.shop_id, kind: "reminder", granted: true, source });
  }
  await logConsentEvents(events);
}
