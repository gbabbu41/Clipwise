import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendGiftCardEmails } from "@/lib/gift-card-server";

type GiftShop = { id: string; name: string | null; email: string | null; slug: string | null };
type GiftResult =
  | { status: "created" | "already"; code: string; amount: number }
  | { status: "mismatch" | "unpaid" }
  | { status: "error"; message: string };

/**
 * Mint a purchased gift card from a PAID checkout session — idempotent via the
 * unique (shop_id, code) index. Records the sale as revenue and emails the code
 * to the recipient + a receipt to the buyer. Shared by the customer-return route
 * AND the webhook fallback, so a buyer who closes the tab still gets their card.
 * The caller must pass a session already verified (retrieved on the right
 * account, or delivered by a signed webhook).
 */
export async function finalizeGiftFromSession(
  session: Stripe.Checkout.Session,
  shop: GiftShop,
  baseUrl: string,
): Promise<GiftResult> {
  const m = session.metadata ?? {};
  if (m.flow !== "gift_card_purchase" || m.shop_id !== shop.id) return { status: "mismatch" };
  if (session.payment_status !== "paid") return { status: "unpaid" };

  const code = m.code!;
  const amount = Number(m.amount ?? 0);

  // Sequential reload → the card already exists; return it, don't re-record/re-email.
  const { data: existing } = await supabaseAdmin
    .from("gift_cards").select("code, initial_value").eq("shop_id", shop.id).eq("code", code).maybeSingle();
  if (existing) return { status: "already", code: existing.code, amount: Number(existing.initial_value) };

  const { error: insErr } = await supabaseAdmin.from("gift_cards").insert({
    shop_id: shop.id,
    code,
    initial_value: amount,
    remaining_value: amount,
    purchased_by: m.purchaser_name || null,
    purchased_by_email: m.purchaser_email || null,
    recipient_name: m.recipient_name || null,
    recipient_email: m.recipient_email || null,
    note: m.note || null,
    is_active: true,
  });
  if (insErr) {
    // A concurrent finalize won the unique-index race — the card exists, so this
    // call is done. Crucially we RETURN here so we don't insert a second revenue
    // row or re-send the emails (the winner already did).
    if (/duplicate|unique/i.test(insErr.message)) return { status: "already", code, amount };
    return { status: "error", message: insErr.message };
  }

  // Record the sale as revenue (mirrors owner-issued gift cards). Progressive
  // column-drop retry so a prod `transactions` table missing `source`/`type`
  // still records the revenue instead of silently swallowing the whole row
  // (which would make every gift sale show $0 revenue).
  const giftTxRow: Record<string, unknown> = {
    shop_id: shop.id, barber_id: null,
    client_name: m.purchaser_name || "Gift card",
    service_name: `Gift Card ${code}`,
    amount, tip: 0, commission_amount: null,
    payment_method: "card", type: "product", source: "gift_card_sale",
  };
  let gtx = await supabaseAdmin.from("transactions").insert(giftTxRow);
  if (gtx.error) {
    const msg = gtx.error.message || "";
    if (/source/.test(msg)) delete giftTxRow.source;
    if (/\btype\b/.test(msg)) delete giftTxRow.type;
    if (/commission_amount/.test(msg)) delete giftTxRow.commission_amount;
    gtx = await supabaseAdmin.from("transactions").insert(giftTxRow);
  }
  if (gtx.error) console.warn("[gift] sale revenue row failed:", gtx.error.message);

  await sendGiftCardEmails({
    shop: { name: shop.name ?? "", slug: shop.slug ?? "", email: shop.email },
    baseUrl,
    meta: {
      code, amount, note: m.note,
      recipient_name: m.recipient_name, recipient_email: m.recipient_email,
      purchaser_name: m.purchaser_name, purchaser_email: m.purchaser_email,
    },
  });

  return { status: "created", code, amount };
}
