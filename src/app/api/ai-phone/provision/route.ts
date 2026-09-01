import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTwilio } from "@/lib/twilio";
import { reconcileAiPhoneAddon } from "@/lib/stripe-addons";

// Provision a ClipWise Business Number for a shop and switch the AI phone on.
//
// Owner-only (moves money + buys a real number). Order is bill-first-then-buy
// with rollback, mirroring /api/shops/add-location, so we never bill for a
// number we couldn't buy — and never hand out a number we couldn't bill.
//
// Inert until the owner clicks "Get My Business Number": nothing here runs on
// its own, and it never touches existing SMS / booking / Stripe flows.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    shop_id?: string; agree_addon?: boolean; area_code?: string;
  };
  if (!body.shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, name, owner_id, subscription_status, stripe_subscription_id, twilio_phone_number")
    .eq("id", body.shop_id).maybeSingle();
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Already has a number → idempotent no-op (just make sure the flags are on).
  if (shop.twilio_phone_number) {
    await supabaseAdmin.from("shops")
      .update({ ai_phone_enabled: true, ai_phone_plan_active: true }).eq("id", shop.id).then(null, () => null);
    return NextResponse.json({ ok: true, number: shop.twilio_phone_number, already: true });
  }

  // The $15/mo add-on rides the owner's existing paid subscription — Stripe can't
  // start a second subscription in a different currency, so require an active one.
  if (shop.subscription_status !== "active" || !shop.stripe_subscription_id) {
    return NextResponse.json(
      { error: "Add a paid plan first — the AI phone is a $15/mo add-on to your subscription." },
      { status: 400 },
    );
  }
  // Paid add-on must be explicitly agreed to (the client shows a $15/mo confirm).
  if (!body.agree_addon) {
    return NextResponse.json(
      { error: "The ClipWise Business Number adds $15/mo to your subscription. Confirm to continue.", needsConfirm: true },
      { status: 409 },
    );
  }

  const twilio = getTwilio();
  if (!twilio) {
    return NextResponse.json(
      { error: "Phone service isn't configured yet. Add your Twilio account details, then try again." },
      { status: 500 },
    );
  }

  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  const areaCode = (body.area_code || "506").replace(/[^\d]/g, "").slice(0, 3) || "506";

  // 1) Bill the add-on FIRST (prorated now), so a number never goes out unbilled.
  try {
    await reconcileAiPhoneAddon(shop.stripe_subscription_id, true, { invoiceNow: true });
  } catch {
    return NextResponse.json({ error: "Couldn't update your billing. Please try again." }, { status: 502 });
  }

  // 2) Buy the number. On any failure, roll the add-on back so the owner isn't
  //    charged for a number they didn't get.
  let provisioned: { phoneNumber: string; sid: string };
  try {
    const num = await twilio.incomingPhoneNumbers.create({
      areaCode,
      voiceUrl: `${baseUrl}/api/voice/incoming`,
      smsUrl: `${baseUrl}/api/sms/incoming`,
    });
    provisioned = { phoneNumber: num.phoneNumber, sid: num.sid };
  } catch (err) {
    await reconcileAiPhoneAddon(shop.stripe_subscription_id, false).catch(() => {});
    const msg = err instanceof Error ? err.message : "Couldn't get a number";
    supabaseAdmin.from("error_logs").insert({
      level: "error", source: "ai-phone-provision",
      message: `Provision failed (shop ${shop.id}): ${msg}`.slice(0, 1000),
      path: "/api/ai-phone/provision",
      shop_id: shop.id,
    }).then(null, () => null);
    return NextResponse.json(
      { error: `Couldn't get a ${areaCode} number: ${msg}. No charge was made.` },
      { status: 502 },
    );
  }

  // 3) Save the number + switch the AI phone on.
  const { error: saveErr } = await supabaseAdmin.from("shops").update({
    twilio_phone_number: provisioned.phoneNumber,
    twilio_phone_sid: provisioned.sid,
    ai_phone_enabled: true,
    ai_phone_plan_active: true,
  }).eq("id", shop.id);
  if (saveErr) {
    // Saved-state failure after buying + billing — don't lose the number silently.
    supabaseAdmin.from("error_logs").insert({
      level: "error", source: "ai-phone-provision",
      message: `Provisioned ${provisioned.phoneNumber} (sid ${provisioned.sid}) but shop save failed: ${saveErr.message}`.slice(0, 1000),
      path: "/api/ai-phone/provision",
      shop_id: shop.id,
    }).then(null, () => null);
    return NextResponse.json({ error: "Number acquired but saving failed — contact support to finish setup." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, number: provisioned.phoneNumber });
}
