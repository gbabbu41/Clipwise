import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { lookupRedeemable } from "@/lib/loyalty-redeem";

// Public (customer booking flow): look up a returning customer's loyalty balance
// by email/phone so they can choose to redeem at checkout. Rate-limited to blunt
// balance-probing, and returns ONLY the points/value the booking UI needs (no
// PII, no client identity). Not eligible → { eligible:false }.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "loyalty-lookup", 20, 60_000);
  if (limited) return limited;

  const { shop_id, email, phone } = await request.json().catch(() => ({})) as {
    shop_id?: string; email?: string; phone?: string;
  };
  const notEligible = NextResponse.json({ eligible: false, points: 0, value: 0 });
  if (!shop_id || (!email?.trim() && !phone?.trim())) return notEligible;

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, subscription_plan, subscription_status, booking_settings")
    .eq("id", shop_id).eq("status", "approved").maybeSingle();
  if (!shop) return notEligible;

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  const result = await lookupRedeemable({
    shopId: shop_id, plan, bookingSettings: shop.booking_settings, email, phone,
  });
  return NextResponse.json(result);
}
