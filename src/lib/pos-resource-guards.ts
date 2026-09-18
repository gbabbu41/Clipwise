import { supabaseAdmin } from "@/lib/supabase-admin";

// Run after caller/shop authorization, before recording a sale or opening
// Checkout. Prices and commission rules remain the existing POS policy.
export async function validatePosResources(shopId: string, input: {
  barber_id?: unknown; products?: unknown; gift_card?: unknown;
}): Promise<{ error: string; status: number } | null> {
  const invalid = { error: "Invalid sale items. Please refresh the cart.", status: 400 };
  const products = input.products ?? [];
  if (!Array.isArray(products)) return invalid;
  const ids: string[] = [];
  for (const product of products) {
    if (!product || typeof product.id !== "string" || !product.id
      || !Number.isSafeInteger(product.qty) || product.qty <= 0) return invalid;
    ids.push(product.id);
  }
  const gift = input.gift_card as { id?: unknown; applied?: unknown } | null | undefined;
  if (gift != null && (typeof gift !== "object" || Array.isArray(gift)
    || typeof gift.id !== "string" || !gift.id || typeof gift.applied !== "number"
    || !Number.isFinite(gift.applied) || gift.applied < 0)) return invalid;
  if (input.barber_id != null && input.barber_id !== ""
    && typeof input.barber_id !== "string") return invalid;

  const targets: { table: "inventory" | "gift_cards" | "barbers"; id: string }[] =
    Array.from(new Set(ids)).map(id => ({ table: "inventory", id }));
  if (gift) targets.push({ table: "gift_cards", id: gift.id as string });
  if (input.barber_id) targets.push({ table: "barbers", id: input.barber_id as string });
  for (const target of targets) {
    const { data, error } = await supabaseAdmin.from(target.table).select("id")
      .eq("id", target.id).eq("shop_id", shopId).maybeSingle();
    if (error) return { error: "Couldn't verify the sale items. Please try again.", status: 503 };
    if (!data) return { error: "A sale item or barber is unavailable in this shop. Please refresh the cart.", status: 400 };
  }
  return null;
}
