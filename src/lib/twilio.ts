import Twilio from "twilio";

/**
 * Lazy-initialized Twilio REST client. Reads creds from env at first call so
 * the module can be imported in routes that don't actually send SMS.
 * Returns `null` when creds are absent — the calling route should treat that
 * as "SMS not configured" rather than throwing.
 */
let cached: Twilio.Twilio | null | undefined;
export function getTwilio(): Twilio.Twilio | null {
  if (cached !== undefined) return cached;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    cached = null;
    return null;
  }
  cached = Twilio(sid, token);
  return cached;
}

/** Either of these is enough — Messaging Service preferred when present. */
export function twilioSender(): { messagingServiceSid?: string; from?: string } | null {
  const mssid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (mssid) return { messagingServiceSid: mssid };
  const from = process.env.TWILIO_FROM_NUMBER;
  if (from) return { from };
  return null;
}

/**
 * Normalize a user-entered phone string to E.164 (`+1xxxxxxxxxx`).
 *
 *  - Strips spaces, dashes, parens, dots
 *  - Adds `+` if missing
 *  - Adds `+1` if the digits don't start with a country code and look like a
 *    10-digit North American number (the format most existing rows use)
 *
 * Returns null if the cleaned value clearly can't be a phone number. The
 * caller should treat null as "no valid SMS target" and skip the send.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) {
    return cleaned.length >= 8 ? cleaned : null;
  }
  // No `+` — assume North American if 10 digits, otherwise prepend `+`
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  if (cleaned.length >= 8) return `+${cleaned}`;
  return null;
}
