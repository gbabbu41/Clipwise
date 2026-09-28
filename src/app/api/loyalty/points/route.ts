import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { logLoyaltyFailure } from "@/lib/loyalty-redeem";

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

  // Balance + ledger row in one locked step (phase68). A redemption is refused
  // (not partially applied) when the balance is short — checked under the lock,
  // so two staff redeeming at once can't overdraw it.
  const { data, error } = await supabaseAdmin.rpc("loyalty_adjust", {
    p_shop_id: shop.id, p_client_id: client_id, p_delta: Math.round(points),
    p_action: points < 0 ? "redeemed" : "added", p_strict: true,
  });
  if (error) {
    if ((error as { code?: string }).code === "22003") return NextResponse.json({ error: "Not enough points to redeem" }, { status: 400 });
    await logLoyaltyFailure("loyalty/points", { shopId: shop.id, clientId: client_id }, error);
    return NextResponse.json({ error: "Couldn't update points. Please try again." }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { balance?: number } | null;
  return NextResponse.json({ ok: true, loyalty_points: Number(row?.balance ?? client.loyalty_points) });
}
