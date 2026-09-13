import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isNativeRequest } from "@/lib/native-app";
import { grantHardwareCredit } from "@/lib/hardware-credit";

// Called by the Card Reader page when the barber FINISHES buying a reader in the
// embedded hardware shop (ConnectTerminalHardwareShop.onCheckoutFinished). Grants
// the one-time reader credit on the shop's ClipWise subscription. Idempotent
// (guarded by shops.hardware_credit_granted), so a stray double-call is harmless.
// Web only (purchase-adjacent). Owner-scoped.
export async function POST(request: NextRequest) {
  if (isNativeRequest(request)) {
    return NextResponse.json({ error: "Not available in the app." }, { status: 403 });
  }
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json().catch(() => ({})) as { shop_id?: string };

  // Confirm the caller owns the shop before crediting it.
  let q = supabaseAdmin.from("shops").select("id").eq("owner_id", user.id);
  if (shop_id) q = q.eq("id", shop_id);
  const { data: rows } = await q.order("created_at", { ascending: false }).limit(1);
  const shop = rows?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  const result = await grantHardwareCredit(shop.id);
  return NextResponse.json(result);
}
