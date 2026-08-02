import { NextRequest } from "next/server";
import Twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTwilio } from "@/lib/twilio";

// Twilio Voice webhook — Twilio POSTs here when a shop's ClipWise Business Number
// rings. Returns TwiML (XML). Two modes:
//   • AI live  (ai_phone_enabled + TWILIO_CONVERSATION_RELAY_URL set) → hand the
//     call to the always-on voice server via <Connect/ConversationRelay>.
//   • Fallback (default) → say a short message, hang up, and text the caller a
//     booking link. This makes a number useful the moment it's provisioned, even
//     before the AI brain is deployed. NEVER lets the call die silently.
//
// Inert until a number is actually provisioned to a shop — reads only, no writes
// to any existing table.

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

  // Verify the request really came from Twilio (these endpoints are public and
  // trigger SMS). Fail-closed when we can validate, fail-open only if no token.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const sig = request.headers.get("x-twilio-signature") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host") ?? "";
  const url = `${proto}://${host}/api/voice/incoming`;
  if (authToken && !Twilio.validateRequest(authToken, sig, url, params)) {
    return new Response("Forbidden", { status: 403 });
  }

  const to = params.To ?? "";       // the shop's business number
  const from = params.From ?? "";   // the caller
  const callSid = params.CallSid ?? null;

  // Which shop owns this number?
  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, name, slug, ai_phone_enabled, twilio_phone_number")
    .eq("twilio_phone_number", to).maybeSingle();

  if (!shop) {
    return twiml(`<Say voice="Polly.Joanna">Sorry, this number isn't set up for bookings right now. Goodbye.</Say><Hangup/>`);
  }

  const baseUrl = `${proto}://${host}`;
  const relayUrl = process.env.TWILIO_CONVERSATION_RELAY_URL;

  // Live AI path — only when explicitly enabled AND the voice server URL is set.
  if (shop.ai_phone_enabled && relayUrl) {
    // Pass the shop id so the voice server can load its context. The server does
    // the STT/LLM/TTS + booking; this webhook just connects the call to it.
    const wsUrl = `${relayUrl}${relayUrl.includes("?") ? "&" : "?"}shopId=${encodeURIComponent(shop.id)}`;
    return twiml(`<Connect><ConversationRelay url="${xmlEscape(wsUrl)}" welcomeGreeting="Thanks for calling ${xmlEscape(shop.name)}. How can I help you book today?" /></Connect>`);
  }

  // Fallback path — say a short message, then text a booking link. Log as missed.
  const shopName = shop.name ?? "the shop";
  supabaseAdmin.from("call_logs").insert({
    shop_id: shop.id, caller_number: from, outcome: "missed", ai_session_id: callSid,
  }).then(null, () => null);

  // Text the caller their booking link — from the shop's OWN number so it's
  // consistent with the number they just called. Best-effort.
  if (from && shop.slug) {
    const twilio = getTwilio();
    const body = `Sorry we missed your call at ${shopName}! Book your spot anytime (60 seconds): ${baseUrl}/book/${shop.slug}`;
    twilio?.messages.create({ to: from, from: shop.twilio_phone_number ?? to, body }).then(null, () => null);
  }

  return twiml(`<Say voice="Polly.Joanna">Thanks for calling ${xmlEscape(shopName)}. We can't take your call right now, but we've just texted you a link to book online. See you soon!</Say><Hangup/>`);
}
