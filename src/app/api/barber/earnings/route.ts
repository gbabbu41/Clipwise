import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");
  let barberQuery = supabaseAdmin.from("barbers").select("id, shop_id, commission_percent").eq("user_id", user.id);
  if (shopId) barberQuery = barberQuery.eq("shop_id", shopId);
  const { data: barberRows } = await barberQuery.order("created_at", { ascending: true }).limit(1);
  const barber = barberRows?.[0];

  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

  // Owner who also cuts keeps 100% — they earned it AND own the shop, so no
  // commission split applies. Detected server-side via the shop's owner_id.
  const effShopId = shopId ?? barber.shop_id;
  let isOwner = false;
  if (effShopId) {
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id").eq("id", effShopId).maybeSingle();
    isOwner = shopRow?.owner_id === user.id;
  }
  const commissionPercent = isOwner ? 100 : barber.commission_percent;

  const period = searchParams.get("period") ?? "month";

  const now = new Date();
  let from: string;
  if (period === "all") {
    from = "1970-01-01";
  } else if (period === "week") {
    const day = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    from = start.toISOString().split("T")[0];
  } else if (period === "year") {
    from = `${now.getFullYear()}-01-01`;
  } else {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }

  const { data: transactions } = await supabaseAdmin
    .from("transactions")
    .select("*")
    .eq("barber_id", barber.id)
    .gte("created_at", from)
    .order("created_at", { ascending: false });

  const list = transactions ?? [];
  const tips = list.reduce((s, t) => s + (t.tip ?? 0), 0);
  const serviceAmount = list.reduce((s, t) => s + t.amount, 0);
  const revenue = serviceAmount + tips;
  // Service-commission portion (no tips). Owner keeps the whole service amount.
  const commission = isOwner
    ? serviceAmount
    : list.reduce((s, t) => s + (t.commission_amount ?? (t.amount * barber.commission_percent) / 100), 0);
  // What the barber takes home = their service commission + all tips.
  // (Owner takes home everything; the shop's cut is whatever is left.)
  const youKeep = isOwner ? revenue : commission + tips;
  const shopKeeps = Math.max(0, revenue - youKeep);

  return NextResponse.json({
    transactions: list,
    summary: {
      revenue,
      commission,
      tips,
      youKeep,
      shopKeeps,
      isOwner,
      count: list.length,
      avgTicket: list.length ? revenue / list.length : 0,
      commissionPercent,
    },
  });
}
