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

  const to = params.To ?? "";  // the shop's business number

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, slug").eq("twilio_phone_number", to).maybeSingle();

  // No matching shop → reply with nothing (empty TwiML), so we never error.
  if (!shop?.slug) return twiml("");

  const baseUrl = `${proto}://${host}`;
  const msg = `Thanks for texting ${shop.name}! Book your appointment here (60 seconds): ${baseUrl}/book/${shop.slug}`;
  return twiml(`<Message>${xmlEscape(msg)}</Message>`);
}
