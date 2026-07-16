import { NextRequest, NextResponse } from "next/server";
import { fetchValidPromo, promoDiscount, promoBlockReason } from "@/lib/promo";

// Public validation for the booking page's promo field. Checks the code exists,
// is active/not-expired, hasn't hit its cap, and hasn't already been used by
// this customer — then returns the authoritative discount for the subtotal.
export async function POST(req: NextRequest) {
  const { shop_id, code, email, phone, subtotal } = await req.json() as {
    shop_id?: string; code?: string; email?: string; phone?: string; subtotal?: number;
  };
  if (!shop_id || !code?.trim()) return NextResponse.json({ valid: false, error: "Enter a code." }, { status: 400 });

  const promo = await fetchValidPromo(shop_id, code);
  if (!promo) return NextResponse.json({ valid: false, error: "Invalid or expired promo code." });

  const blocked = await promoBlockReason(promo, email, phone);
  if (blocked) return NextResponse.json({ valid: false, error: blocked });

  const discount = promoDiscount(promo, Math.max(0, Number(subtotal ?? 0)));
  return NextResponse.json({
    valid: true,
    code: promo.code,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    discount,
  });
}
