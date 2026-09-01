import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTwilio } from "@/lib/twilio";
import { reconcileAiPhoneAddon } from "@/lib/stripe-addons";

// Cancel a shop's ClipWise Business Number: release the Twilio number, stop the
// $15/mo add-on, and clear the AI-phone flags. Owner-only.
//
// (This is full cancellation. A lighter "just pause the AI, keep the number"
// toggle flips shops.ai_phone_enabled via the settings save — no billing change.)
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json().catch(() => ({})) as { shop_id?: string };
  if (!shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, owner_id, stripe_subscription_id, twilio_phone_sid")
    .eq("id", shop_id).maybeSingle();
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Release the Twilio number (best-effort — a Twilio hiccup shouldn't strand the
  // owner still being billed; we still stop the add-on + clear the flags below).
  if (shop.twilio_phone_sid) {
    const twilio = getTwilio();
    if (twilio) {
      try {
        await twilio.incomingPhoneNumbers(shop.twilio_phone_sid).remove();
      } catch (err) {
        supabaseAdmin.from("error_logs").insert({
          level: "warn", source: "ai-phone-release",
          message: `Twilio release failed (shop ${shop.id}, sid ${shop.twilio_phone_sid}): ${err instanceof Error ? err.message : "error"}`.slice(0, 1000),
          path: "/api/ai-phone/release",
          shop_id: shop.id,
        }).then(null, () => null);
      }
    }
  }

  // Stop the $15/mo add-on.
  if (shop.stripe_subscription_id) {
    await reconcileAiPhoneAddon(shop.stripe_subscription_id, false).catch(() => {});
  }

  // Clear the AI-phone state.
  await supabaseAdmin.from("shops").update({
    twilio_phone_number: null,
    twilio_phone_sid: null,
    ai_phone_enabled: false,
    ai_phone_plan_active: false,
  }).eq("id", shop.id);

  return NextResponse.json({ ok: true });
}
