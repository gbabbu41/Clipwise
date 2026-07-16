import { supabaseAdmin } from "@/lib/supabase-admin";

// ── Server-side promo code enforcement ───────────────────────────────────────
// The booking page validates + discounts client-side for UX, but the server is
// the source of truth: it re-checks the code, recomputes the discount, enforces
// the total cap + once-per-customer, and consumes the code at booking time.

export type PromoRow = {
  id: string;
  shop_id: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  uses_left: number | null;   // null = unlimited total
  total_uses: number | null;
  expires_at: string | null;
  is_active: boolean;
};

/** Fetch an active, non-expired promo for a shop, or null. */
export async function fetchValidPromo(shopId: string, code: string): Promise<PromoRow | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("promo_codes").select("*")
    .eq("shop_id", shopId).eq("code", code.trim().toUpperCase()).eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gte.${today}`)
    .maybeSingle();
  return (data as PromoRow | null) ?? null;
}

/** Dollar discount for a subtotal, clamped to [0, subtotal]. */
export function promoDiscount(promo: PromoRow, subtotal: number): number {
  const raw = promo.discount_type === "percent"
    ? subtotal * (promo.discount_value / 100)
    : promo.discount_value;
  return Math.max(0, Math.min(subtotal, Math.round(raw * 100) / 100));
}

/** Why the customer can't use this code right now, or null if they can. */
export async function promoBlockReason(promo: PromoRow, email?: string | null, phone?: string | null): Promise<string | null> {
  if (promo.uses_left != null && promo.uses_left <= 0) return "This promo code has reached its usage limit.";
  const e = (email ?? "").trim().toLowerCase();
  const p = (phone ?? "").trim();
  if (e) {
    const { data } = await supabaseAdmin.from("promo_redemptions")
      .select("id").eq("promo_code_id", promo.id).ilike("client_email", e).maybeSingle();
    if (data) return "You've already used this promo code.";
  }
  if (p) {
    const { data } = await supabaseAdmin.from("promo_redemptions")
      .select("id").eq("promo_code_id", promo.id).eq("client_phone", p).maybeSingle();
    if (data) return "You've already used this promo code.";
  }
  return null;
}

/**
 * Consume the code for a booking: record the redemption (which enforces
 * once-per-customer via unique indexes) and draw down the total cap. Idempotent
 * per appointment. Best-effort — never throws; returns whether it recorded.
 */
export async function consumePromo(
  promo: PromoRow, shopId: string, email: string | null, phone: string | null, appointmentId: string | null,
): Promise<boolean> {
  try {
    // Idempotency: already recorded for this appointment?
    if (appointmentId) {
      const { data: existing } = await supabaseAdmin.from("promo_redemptions")
        .select("id").eq("promo_code_id", promo.id).eq("appointment_id", appointmentId).maybeSingle();
      if (existing) return true;
    }
    const { error: insErr } = await supabaseAdmin.from("promo_redemptions").insert({
      shop_id: shopId, promo_code_id: promo.id, code: promo.code,
      client_email: (email ?? "").trim() || null,
      client_phone: (phone ?? "").trim() || null,
      appointment_id: appointmentId,
    });
    // A unique-index hit means this customer already redeemed it (race backstop);
    // don't decrement again.
    if (insErr) return false;

    // Draw down the cap (optimistic: only if still available) + bump total_uses.
    if (promo.uses_left != null) {
      await supabaseAdmin.from("promo_codes")
        .update({ uses_left: Math.max(0, promo.uses_left - 1), total_uses: (promo.total_uses ?? 0) + 1 })
        .eq("id", promo.id).eq("uses_left", promo.uses_left).then(null, () => null);
    } else {
      await supabaseAdmin.from("promo_codes")
        .update({ total_uses: (promo.total_uses ?? 0) + 1 }).eq("id", promo.id).then(null, () => null);
    }
    return true;
  } catch {
    return false;
  }
}
