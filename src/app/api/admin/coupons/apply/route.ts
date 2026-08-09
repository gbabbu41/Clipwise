import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { grantFreeDays } from "@/lib/grant-free-days";

// Admin one-tap comp: give a specific shop free Pro/Premium days directly (no
// coupon code). super_admin only. { shop_id, plan, days }
export async function POST(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { shop_id, plan = "pro", days } = await req.json().catch(() => ({})) as {
    shop_id?: string; plan?: string; days?: number;
  };
  if (!shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });

  const result = await grantFreeDays(shop_id, plan, Number(days));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 400 });

  await logAdminAction(admin, {
    action: "coupon.grant", target_type: "shop", target_id: shop_id, target_label: shop_id,
    meta: { plan: result.plan, days: Math.round(Number(days)), trial_ends_at: result.trialEndsAt },
  });
  return NextResponse.json({ ok: true, plan: result.plan, trialEndsAt: result.trialEndsAt });
}
