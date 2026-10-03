import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop } from "@/lib/api-auth";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { generateGiftCode, sendGiftCardEmails } from "@/lib/gift-card-server";

// Owner/staff issues a CASH gift card (real cash collected in person): creates
// the card, records a real cash sale in the ledger, and emails the code. Or, with
// mode "free", the OWNER gives a complimentary card (promo, apology, giveaway):
// the card is created and emailed but NO sale is recorded — no money came in, so
// it's never income (and redeeming it later isn't either). No Stripe — card/link
// purchases go through /api/stripe/gift-checkout instead.
export async function POST(request: NextRequest) {
  const b = await request.json() as {
    shop_id: string; amount: number;
    purchased_by?: string; purchased_by_email?: string;
    recipient_name?: string; recipient_email?: string; note?: string;
    mode?: "cash" | "free";
  };
  if (!b.shop_id) return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  if (b.mode !== undefined && b.mode !== "cash" && b.mode !== "free") return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  const free = b.mode === "free";
  // Giving value away is the owner's call — staff can only record a real cash sale.
  const auth = await authorizeShop(request, b.shop_id, free ? { ownerOnly: true } : undefined);
  if ("error" in auth) return auth.error;

  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!amount || amount <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  if (amount > 1000) return NextResponse.json({ error: "Maximum gift card is $1000" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, slug, email, subscription_plan, subscription_status").eq("id", b.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "loyalty")) return NextResponse.json({ error: "Gift cards require a paid plan." }, { status: 403 });

  const code = generateGiftCode();
  const cardRow: Record<string, unknown> = {
    shop_id: shop.id, code, initial_value: amount, remaining_value: amount,
    purchased_by: b.purchased_by?.trim() || null,
    purchased_by_email: b.purchased_by_email?.trim() || null,
    recipient_name: b.recipient_name?.trim() || null,
    recipient_email: b.recipient_email?.trim() || null,
    note: free ? `Complimentary${b.note?.trim() ? ` — ${b.note.trim()}` : ""}` : (b.note?.trim() || null),
    is_active: true,
    // A free card is a 100% promo when used: no income, tax, tip or commission (phase77).
    ...(free ? { complimentary: true } : {}),
  };
  let { error: insErr } = await supabaseAdmin.from("gift_cards").insert(cardRow);
  // A database a step behind (no `complimentary` column yet): the "Complimentary"
  // note still marks it, and phase77 backfills the flag from that note.
  if (insErr && /complimentary/.test(insErr.message ?? "")) {
    delete cardRow.complimentary;
    ({ error: insErr } = await supabaseAdmin.from("gift_cards").insert(cardRow));
  }
  if (insErr) return NextResponse.json({ error: "Couldn't issue the gift card." }, { status: 500 });

  // Real cash sale → record revenue (mirrors the POS cash-sale ledger row).
  // A complimentary card records nothing: no money came in.
  if (!free) {
    // Progressive column-drop retry so a prod table missing source/type still
    // records the revenue instead of silently dropping the whole row ($0 revenue).
    const cashGiftRow: Record<string, unknown> = {
      shop_id: shop.id, barber_id: null,
      client_name: b.purchased_by?.trim() || b.recipient_name?.trim() || "Gift card",
      service_name: `Gift Card ${code}`,
      amount, tip: 0, commission_amount: null,
      payment_method: "cash", type: "product", source: "gift_card_sale",
    };
    let cgtx = await supabaseAdmin.from("transactions").insert(cashGiftRow);
    if (cgtx.error) {
      const msg = cgtx.error.message || "";
      if (/source/.test(msg)) delete cashGiftRow.source;
      if (/\btype\b/.test(msg)) delete cashGiftRow.type;
      if (/commission_amount/.test(msg)) delete cashGiftRow.commission_amount;
      cgtx = await supabaseAdmin.from("transactions").insert(cashGiftRow);
    }
    if (cgtx.error) console.warn("[gift] cash sale revenue row failed:", cgtx.error.message);
  }

  // Canonical app URL, never the caller-supplied Origin — this link is emailed to
  // the customer, so it must not be attacker-influenceable.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca").replace(/\/+$/, "");
  await sendGiftCardEmails({
    shop: { name: shop.name, slug: shop.slug, email: shop.email },
    baseUrl,
    meta: {
      code, amount, note: b.note,
      recipient_name: b.recipient_name, recipient_email: b.recipient_email,
      purchaser_name: b.purchased_by, purchaser_email: b.purchased_by_email,
    },
  });

  return NextResponse.json({ ok: true, code });
}
