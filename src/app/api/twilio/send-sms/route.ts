import { NextRequest, NextResponse } from "next/server";
import { getTwilio, twilioSender, toE164 } from "@/lib/twilio";

/**
 * Send a one-off SMS via Twilio.
 *
 * Body:
 *   { to: string, body: string, shopName?: string }
 *
 * The shop name is optional but recommended — when present it's prefixed
 * onto the message so the recipient sees who's texting them (the sender
 * number on a shared trial line means nothing to the customer).
 *
 * Returns 200 with `{ sid, to }` on success, 4xx/5xx with `{ error }`
 * otherwise. Designed to be called fire-and-forget from the messages page
 * alongside the email send — so the message stays in-app even if SMS fails.
 */
export async function POST(request: NextRequest) {
  const { to, body, shopName } = await request.json() as {
    to: string;
    body: string;
    shopName?: string;
  };

  if (!to || !body) {
    return NextResponse.json({ error: "Missing `to` or `body`." }, { status: 400 });
  }

  const twilio = getTwilio();
  const sender = twilioSender();
  if (!twilio || !sender) {
    return NextResponse.json(
      { error: "SMS is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM_NUMBER) to .env." },
      { status: 500 },
    );
  }

  const e164 = toE164(to);
  if (!e164) {
    return NextResponse.json({ error: `Invalid phone number: ${to}` }, { status: 400 });
  }

  // Prefix the shop name so the recipient knows who's writing. Skip the
  // prefix if the body already starts with the shop name (e.g. owner already
  // typed "Hi from FreshCutz: …"), so we don't double-stamp.
  const prefixedBody = shopName && !body.toLowerCase().startsWith(shopName.toLowerCase())
    ? `${shopName}: ${body}`
    : body;

  try {
    const msg = await twilio.messages.create({
      to: e164,
      body: prefixedBody,
      ...sender,
    });
    return NextResponse.json({ sid: msg.sid, to: e164 });
  } catch (err) {
    // Twilio errors carry a `code` and `message`. Surface them so the caller
    // can decide what to show — trial-mode unverified-number errors look
    // distinct from quota / auth errors and the owner needs to know which.
    const e = err as { code?: number; message?: string; status?: number };
    return NextResponse.json(
      {
        error: e.message ?? "Twilio send failed",
        twilio_code: e.code,
      },
      { status: e.status ?? 500 },
    );
  }
}
