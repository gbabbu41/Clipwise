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
 * A gift-card change that could not be saved. Logged to error_logs (ids only) so
 * stored money never moves — or fails to — without a trace. Never throws.
 */
export async function logGiftFailure(where: string, ids: { shopId?: string | null; appointmentId?: string | null; giftCardId?: string | null }, error: unknown): Promise<void> {
  const reason = (error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "unknown error")).slice(0, 200);
  const message = `Gift card change failed (${where}): card ${ids.giftCardId ?? "n/a"}, appointment ${ids.appointmentId ?? "n/a"} — ${reason}`;
  console.error("[gift-card]", message);
  try {
    await supabaseAdmin.from("error_logs").insert({ level: "error", source: "gift-card", message, path: where, shop_id: ids.shopId ?? null });
  } catch { /* best-effort */ }
}

type GiftResult = { applied: number; balance: number | null };
const rowOf = (data: unknown): GiftResult => {
  const row = (Array.isArray(data) ? data[0] : data) as { applied?: number | string; balance?: number | string | null } | null;
  return { applied: Math.abs(Number(row?.applied ?? 0)), balance: row?.balance == null ? null : Number(row.balance) };
};

/**
 * Spend a gift card on a booking, in ONE database step (phase69): the card row is
 * locked, the balance can't be overdrawn (all-or-nothing with `requireFull`), the
 * spend is recorded against the booking — so cancelling it gives the value back
 * automatically — and a retry for the same booking never spends twice. Returns
 * the dollars applied (0 on failure, which is logged) and the card's new balance.
 */
export async function redeemGiftForBooking(opts: {
  shopId: string; code: string; amount: number; appointmentId: string; requireFull?: boolean;
}): Promise<GiftResult> {
  const want = Math.max(0, Math.round(opts.amount * 100) / 100);
  const code = cleanCode(opts.code);
  if (!want || !code) return { applied: 0, balance: null };
  const ids = { shopId: opts.shopId, appointmentId: opts.appointmentId };
  try {
    const { data, error } = await supabaseAdmin.rpc("gift_redeem_for_appointment", {
      p_shop_id: opts.shopId, p_code: code, p_amount: want, p_appointment_id: opts.appointmentId, p_require_full: !!opts.requireFull,
    });
    if (error) { await logGiftFailure("redeemGiftForBooking", ids, error); return { applied: 0, balance: null }; }
    return rowOf(data);
  } catch (e) {
    await logGiftFailure("redeemGiftForBooking", ids, e);
    return { applied: 0, balance: null };
  }
}

/** Spend a gift card on a POS sale (no booking): same atomic step, capped at the balance. */
export async function redeemGiftCard(opts: { shopId: string; giftCardId: string; amount: number }): Promise<GiftResult> {
  const want = Math.max(0, Math.round(opts.amount * 100) / 100);
  if (!want) return { applied: 0, balance: null };
  const ids = { shopId: opts.shopId, giftCardId: opts.giftCardId };
  try {
    const { data, error } = await supabaseAdmin.rpc("gift_adjust", {
      p_shop_id: opts.shopId, p_gift_card_id: opts.giftCardId, p_delta: -want, p_action: "redeemed",
    });
    if (error) { await logGiftFailure("redeemGiftCard", ids, error); return { applied: 0, balance: null }; }
    return rowOf(data);
  } catch (e) {
    await logGiftFailure("redeemGiftCard", ids, e);
    return { applied: 0, balance: null };
  }
}
