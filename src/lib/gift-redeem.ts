import { supabaseAdmin } from "@/lib/supabase-admin";

// Gift-card redemption at booking. A gift card is STORED MONEY, so — unlike a
// promo/loyalty discount — it's applied like cash to the FINAL amount due (after
// tax + tip), never to the pre-tax price. Server-authoritative: the browser only
// ever sends a code; the balance + applied amount come from the DB.

const cleanCode = (code?: string | null) => (code ?? "").trim().toUpperCase().replace(/\s+/g, "");

/** A shop's active gift card with a positive balance, or null. */
export async function findRedeemableGift(shopId: string, code?: string | null): Promise<{ id: string; code: string; balance: number } | null> {
  const clean = cleanCode(code);
  if (!clean) return null;
  const { data } = await supabaseAdmin
    .from("gift_cards").select("id, code, remaining_value, is_active")
    .eq("shop_id", shopId).eq("code", clean).maybeSingle();
  if (!data || !data.is_active) return null;
  const balance = Math.max(0, Number(data.remaining_value ?? 0));
  if (balance <= 0) return null;
  return { id: data.id, code: data.code, balance };
}

/**
 * Draw down a gift card by `applyDollars`, capped at its LIVE balance (re-read
 * so a stale amount can never overdraw it). Returns the amount actually applied.
 * Best-effort: called after the booking exists, once (both booking paths de-dupe
 * the appointment), so it can't double-spend.
 */
export async function redeemGift(shopId: string, code: string, applyDollars: number): Promise<number> {
  const gift = await findRedeemableGift(shopId, code);
  if (!gift) return 0;
  const applied = Math.min(gift.balance, Math.max(0, Math.round(applyDollars * 100) / 100));
  if (applied <= 0) return 0;
  const newBalance = Math.round((gift.balance - applied) * 100) / 100;
  await supabaseAdmin.from("gift_cards").update({
    remaining_value: newBalance,
    is_active: newBalance > 0,
    redeemed_at: new Date().toISOString(),
  }).eq("id", gift.id);
  return applied;
}
