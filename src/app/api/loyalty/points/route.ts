import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { client_id, points, shop_id } = body as { client_id: string; points: number; shop_id?: string };
  if (!client_id || typeof points !== "number" || points === 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Resolve the owner's shop. Accept an explicit shop_id (multi-location owners
  // operate on their active location) and verify it's theirs; else first shop.
  // Without this, points always resolved to the owner's FIRST shop, so managing
  // a client of any other location failed with "Client not found".
  let shopQuery = supabaseAdmin
    .from("shops").select("id, subscription_plan, subscription_status, owner_id")
    .eq("owner_id", user.id);
  if (shop_id) shopQuery = shopQuery.eq("id", shop_id);
  const { data: shops } = await shopQuery.limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "loyalty")) {
    return NextResponse.json({ error: "Loyalty program requires a paid plan" }, { status: 403 });
  }

  // Verify client belongs to this shop
  const { data: client } = await supabaseAdmin
    .from("clients").select("id, loyalty_points").eq("id", client_id).eq("shop_id", shop.id).single();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Negative = redemption. Reject if the client doesn't have enough points.
  if (points < 0 && client.loyalty_points + points < 0) {
    return NextResponse.json({ error: "Not enough points to redeem" }, { status: 400 });
  }

  const newTotal = Math.max(0, client.loyalty_points + points);
  const { error } = await supabaseAdmin
    .from("clients").update({ loyalty_points: newTotal }).eq("id", client_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log (best-effort) — 'redeemed' for deductions, 'added' for manual credits.
  await supabaseAdmin.from("loyalty_rewards").insert({
    shop_id: shop.id, client_id, points, action: points < 0 ? "redeemed" : "added",
  }).then(null, () => null);

  return NextResponse.json({ ok: true, loyalty_points: newTotal });
}
