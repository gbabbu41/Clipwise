import { NextRequest } from "next/server";
import Twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { withdrawPromoConsent, regrantPromoConsent } from "@/lib/consent";
import { normPhone } from "@/lib/client-identity";

// Twilio inbound-SMS webhook — Twilio POSTs here when someone texts a shop's
// ClipWise Business Number. Replies with the shop's booking link (TwiML). Read
// only; never touches existing SMS-sending flows.
const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const params: Record<string, string> = {};
  if (form) form.forEach((v, k) => { params[k] = String(v); });

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const sig = request.headers.get("x-twilio-signature") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host") ?? "";
  const url = `${proto}://${host}/api/sms/incoming`;
  // Fail CLOSED in production: without a token we can't verify the request came
  // from Twilio, and this route can grant/withdraw CASL consent — so an
  // unverifiable POST must be rejected, never trusted. (No token in local dev is
  // allowed through so the flow is testable.)
  if (authToken) {
    if (!Twilio.validateRequest(authToken, sig, url, params)) return new Response("Forbidden", { status: 403 });
  } else if (process.env.NODE_ENV === "production") {
    return new Response("Forbidden", { status: 403 });
  }

  const to = params.To ?? "";      // the shop's business number
  const from = params.From ?? "";  // the texter's number (E.164)
  const bodyText = (params.Body ?? "").trim().toUpperCase();

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, slug").eq("twilio_phone_number", to).maybeSingle();

  // ── STOP / START (CASL opt-out) ─────────────────────────────────────────────
  // Twilio's Messaging Service also blocks STOP at the carrier level, but we
  // record it too so our own promo sends (email + cron nudges) honor it. Match the
  // texter's number to this shop's clients via the indexed normalized-phone column
  // (digits, last 10) so any stored format matches. Best-effort — never throw.
  // Bilingual — New Brunswick is officially bilingual, so honor the French
  // keywords too (ARRÊT, with and without the accent + the verb form).
  const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ARRÊT", "ARRET", "ARRÊTER", "ARRETER", "DÉSABONNER", "DESABONNER"]);
  const START_WORDS = new Set(["START", "UNSTOP", "YES", "DÉBUT", "DEBUT", "OUI"]);
  const fromNorm = normPhone(from);
  const matchIds = async (): Promise<string[]> => {
    if (!shop?.id || !fromNorm) return [];
    const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", shop.id).eq("phone_normalized", fromNorm);
    return (data ?? []).map((c) => c.id);
  };
  if (STOP_WORDS.has(bodyText)) {
    // A STOP text silences the whole number at the carrier level, so withdraw
    // promo consent AND turn off reminder texts (permanent hard block until START).
    await withdrawPromoConsent(await matchIds(), { source: "sms_stop", alsoStopReminderSms: true });
    return twiml(`<Message>You're unsubscribed from ${xmlEscape(shop?.name ?? "our")} messages. Reply START to opt back in.</Message>`);
  }
  if (START_WORDS.has(bodyText)) {
    await regrantPromoConsent(await matchIds(), "sms_start");
    return twiml(`<Message>You're opted back in${shop?.name ? ` to ${xmlEscape(shop.name)} messages` : ""}. Reply STOP anytime to opt out.</Message>`);
  }

  // No matching shop → reply with nothing (empty TwiML), so we never error.
  if (!shop?.slug) return twiml("");

  const baseUrl = `${proto}://${host}`;
  const msg = `Thanks for texting ${shop.name}! Book your appointment here (60 seconds): ${baseUrl}/book/${shop.slug}`;
  return twiml(`<Message>${xmlEscape(msg)}</Message>`);
}
