import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { findRedeemableGift } from "@/lib/gift-redeem";

// Public (booking flow): check a gift-card code + return its balance so the
// customer can apply it at checkout. Rate-limited to blunt code-guessing.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "gift-lookup", 15, 60_000);
  if (limited) return limited;

  const { shop_id, code } = await request.json().catch(() => ({})) as { shop_id?: string; code?: string };
  const notValid = NextResponse.json({ valid: false, balance: 0 });
  if (!shop_id || !code?.trim()) return notValid;

  // Only for a real, approved shop.
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id").eq("id", shop_id).eq("status", "approved").maybeSingle();
  if (!shop) return notValid;

  const gift = await findRedeemableGift(shop_id, code);
  if (!gift) return notValid;
  return NextResponse.json({ valid: true, balance: gift.balance, code: gift.code });
}
