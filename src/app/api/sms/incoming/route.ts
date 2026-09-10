import { NextRequest } from "next/server";
import Twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
  if (authToken && !Twilio.validateRequest(authToken, sig, url, params)) {
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
  // texter's number to this shop's client rows in JS (stored phones vary in
  // format), keyed by the last 10 digits. Best-effort — never throw.
  const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
  const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
  const fromDigits = from.replace(/\D/g, "").slice(-10);
  const matchIds = async (): Promise<string[]> => {
    if (!shop?.id || fromDigits.length < 10) return [];
    const { data } = await supabaseAdmin.from("clients").select("id, phone").eq("shop_id", shop.id);
    return (data ?? [])
      .filter((c) => (c.phone ?? "").replace(/\D/g, "").slice(-10) === fromDigits)
      .map((c) => c.id);
  };
  if (STOP_WORDS.has(bodyText)) {
    const ids = await matchIds();
    if (ids.length) {
      // marketing_opt_out always exists; promo_consent may lag pre-migration, so
      // set it in a separate best-effort call that can't fail the opt-out.
      await supabaseAdmin.from("clients").update({ marketing_opt_out: true }).in("id", ids).then(null, () => null);
      await supabaseAdmin.from("clients").update({ promo_consent: false }).in("id", ids).then(null, () => null);
    }
    return twiml(`<Message>You're unsubscribed from ${shop?.name ?? "our"} marketing messages. Reply START to opt back in.</Message>`);
  }
  if (START_WORDS.has(bodyText)) {
    const ids = await matchIds();
    if (ids.length) {
      await supabaseAdmin.from("clients").update({ marketing_opt_out: false }).in("id", ids).then(null, () => null);
    }
    return twiml(`<Message>You're opted back in${shop?.name ? ` to ${shop.name} messages` : ""}. Reply STOP anytime to opt out.</Message>`);
  }

  // No matching shop → reply with nothing (empty TwiML), so we never error.
  if (!shop?.slug) return twiml("");

  const baseUrl = `${proto}://${host}`;
  const msg = `Thanks for texting ${shop.name}! Book your appointment here (60 seconds): ${baseUrl}/book/${shop.slug}`;
  return twiml(`<Message>${xmlEscape(msg)}</Message>`);
}
