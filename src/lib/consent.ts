import { supabaseAdmin } from "@/lib/supabase-admin";

// CASL consent helpers — the ONE place the "can we send this person a
// promotional message?" rule and the booking-time consent record live, so every
// send path (email campaigns, cron nudges) and every booking path agree.
//
// The rule, in plain terms:
//   • Transactional messages (appointment reminders/confirmations) ride on the
//     booked transaction — allowed unless the customer opted out of reminders.
//   • Promotional messages need EXPRESS consent (they ticked the offers box) OR
//     IMPLIED consent from an existing business relationship — a visit within the
//     last 24 months (the CASL window). A STOP/unsubscribe (marketing_opt_out)
//     always wins and blocks everything promotional.

// CASL: implied consent from an existing business relationship lasts 24 months
// from the client's last transaction/visit.
const IMPLIED_CONSENT_DAYS = 24 * 30; // ~24 months

export type PromoEligibility = {
  promo_consent?: boolean | null;
  marketing_opt_out?: boolean | null;
  last_visit?: string | null;
};

/** Can this client receive PROMOTIONAL messages? Express consent (ticked the
 *  offers box) OR implied consent (visited within 24 months) — and NEVER if
 *  they've opted out. One gate for every promo path (campaigns + cron nudges). */
export function canReceivePromos(c: PromoEligibility): boolean {
  if (c.marketing_opt_out) return false;   // a STOP / unsubscribe always wins
  if (c.promo_consent) return true;         // express consent on file
  // Implied consent: an existing business relationship within the CASL window.
  if (c.last_visit) {
    const last = Date.parse(`${c.last_visit}T00:00:00Z`);
    if (Number.isFinite(last) && last >= Date.now() - IMPLIED_CONSENT_DAYS * 86_400_000) {
      return true;
    }
  }
  return false;
}

/** Best-effort client IP from proxy headers (Vercel/most proxies set
 *  x-forwarded-for). Stored with the consent record as proof of when/where the
 *  customer gave it. */
export function clientIpFrom(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip");
}

/**
 * Record the customer's consent choices on their client row at booking time,
 * with a timestamp + IP (the CASL proof-of-consent record). Best-effort: consent
 * bookkeeping must NEVER block or fail a booking. Only writes the flags that were
 * actually sent (a staff walk-in sends none → nothing is overwritten), and only
 * when we can resolve the client (a client id, or an email/phone on file).
 */
export async function recordBookingConsent(args: {
  shopId: string;
  clientId?: string | null;
  email?: string | null;
  phone?: string | null;
  smsReminderConsent?: boolean;
  promoConsent?: boolean;
  ip?: string | null;
}): Promise<void> {
  if (args.smsReminderConsent === undefined && args.promoConsent === undefined) return;
  const patch: Record<string, unknown> = { consent_at: new Date().toISOString() };
  if (args.ip) patch.consent_ip = String(args.ip).slice(0, 60);
  if (args.smsReminderConsent !== undefined) patch.sms_reminder_consent = !!args.smsReminderConsent;
  if (args.promoConsent !== undefined) patch.promo_consent = !!args.promoConsent;
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
    // If the consent columns haven't been migrated on prod yet, the update errors
    // on the missing column — swallow it (best-effort) rather than fail anything.
    await supabaseAdmin.from("clients").update(patch).eq("id", clientId).then(null, () => null);
  } catch { /* consent is best-effort — never block a booking */ }
}
