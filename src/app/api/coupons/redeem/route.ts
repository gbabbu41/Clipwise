import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { grantFreeDays } from "@/lib/grant-free-days";

// Customer redeems a comp coupon code in Billing → free Pro/Premium days.
// Authenticated shop owner only; validates the code server-side (never trust the
// client for plan/days), one redemption per shop per code, honours max_uses +
// expiry. { code, shop_id? }
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "coupon-redeem", 10, 60_000);
  if (limited) return limited;

  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code: rawCode, shop_id } = await request.json().catch(() => ({})) as { code?: string; shop_id?: string };
  const code = (rawCode ?? "").trim().toUpperCase().slice(0, 40);
  if (!code) return NextResponse.json({ error: "Enter a coupon code." }, { status: 400 });

  // Owner-scoped shop resolution (a shop_id they don't own resolves to nothing).
  let q = supabaseAdmin.from("shops").select("id").eq("owner_id", user.id);
  if (shop_id) q = q.eq("id", shop_id);
  const { data: shops } = await q.order("created_at", { ascending: true }).limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found on your account." }, { status: 404 });

  // Look up + validate the coupon.
  const { data: coupon } = await supabaseAdmin
    .from("plan_coupons").select("*").ilike("code", code).maybeSingle();
  if (!coupon || !coupon.is_active) return NextResponse.json({ error: "That coupon isn't valid." }, { status: 400 });
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "That coupon has expired." }, { status: 400 });
  }
  if ((coupon.used_count ?? 0) >= (coupon.max_uses ?? 1)) {
    return NextResponse.json({ error: "That coupon has already been fully used." }, { status: 400 });
  }

  // One redemption per shop per coupon — the unique index is the real backstop.
  const { data: already } = await supabaseAdmin
    .from("plan_coupon_redemptions").select("id").eq("coupon_id", coupon.id).eq("shop_id", shop.id).maybeSingle();
  if (already) return NextResponse.json({ error: "You've already used this coupon." }, { status: 409 });

  const result = await grantFreeDays(shop.id, coupon.plan, coupon.days);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code === "paid_sub" ? 409 : 400 });

  // Record the redemption (unique on coupon+shop guards a double-submit race),
  // then bump the usage count. Best-effort — the grant already applied.
  const ins = await supabaseAdmin.from("plan_coupon_redemptions")
    .insert({ coupon_id: coupon.id, shop_id: shop.id, days_granted: coupon.days });
  if (ins.error && (ins.error as { code?: string }).code === "23505") {
    return NextResponse.json({ error: "You've already used this coupon." }, { status: 409 });
  }
  await supabaseAdmin.from("plan_coupons").update({ used_count: (coupon.used_count ?? 0) + 1 }).eq("id", coupon.id);

  return NextResponse.json({ ok: true, plan: result.plan, days: coupon.days, trialEndsAt: result.trialEndsAt });
}
