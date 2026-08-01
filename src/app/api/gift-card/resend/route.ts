import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop } from "@/lib/api-auth";
import { sendAppEmail } from "@/lib/emailer";
import { giftCardEmailHtml } from "@/lib/gift-card-server";

// Owner/staff re-sends a gift card's code to a customer (from the Gift Cards
// page). Sends to a given address, or the card's recipient/buyer on file.
// Returns the real send result so the owner knows if it actually went out.
export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({})) as { gift_card_id?: string; email?: string };
  if (!b.gift_card_id) return NextResponse.json({ ok: false, error: "Missing gift card" }, { status: 400 });

  const { data: card } = await supabaseAdmin
    .from("gift_cards")
    .select("id, shop_id, code, initial_value, remaining_value, recipient_name, recipient_email, purchased_by, purchased_by_email, note")
    .eq("id", b.gift_card_id).maybeSingle();
  if (!card) return NextResponse.json({ ok: false, error: "Gift card not found" }, { status: 404 });

  const auth = await authorizeShop(request, card.shop_id);
  if ("error" in auth) return auth.error;

  const to = (b.email?.trim() || card.recipient_email || card.purchased_by_email || "").trim();
  if (!to) return NextResponse.json({ ok: false, error: "No email to send to — add one." }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("name, slug, email").eq("id", card.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ ok: false, error: "Shop not found" }, { status: 404 });

  // Show the CURRENT balance (remaining), not the original — accurate on a
  // partially-used card.
  const amount = Math.max(0, Number(card.remaining_value ?? card.initial_value ?? 0));
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const html = giftCardEmailHtml(
    shop.name, `${baseUrl}/book/${shop.slug}`,
    { code: card.code, amount, note: card.note },
    "Your gift card 🎁",
    `Here's your $${amount.toFixed(2)} gift card for ${shop.name}. Present this code at checkout.`,
  );
  const r = await sendAppEmail("marketing_campaign", {
    to, subject: `Your gift card — ${shop.name} 🎁`, htmlBody: html, shopEmail: shop.email ?? "",
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: "Couldn't send — check the address and try again." }, { status: 502 });
  return NextResponse.json({ ok: true, sentTo: to });
}
