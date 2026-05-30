import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");
  let barberQuery = supabaseAdmin.from("barbers").select("id, commission_percent").eq("user_id", user.id);
  if (shopId) barberQuery = barberQuery.eq("shop_id", shopId);
  const { data: barberRows } = await barberQuery.order("created_at", { ascending: true }).limit(1);
  const barber = barberRows?.[0];

  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

  const period = searchParams.get("period") ?? "month";

  const now = new Date();
  let from: string;
  if (period === "week") {
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
  const revenue = list.reduce((s, t) => s + t.amount + (t.tip ?? 0), 0);
  const commission = list.reduce((s, t) => s + (t.commission_amount ?? (t.amount * barber.commission_percent) / 100), 0);

  return NextResponse.json({
    transactions: list,
    summary: {
      revenue,
      commission,
      count: list.length,
      avgTicket: list.length ? revenue / list.length : 0,
      commissionPercent: barber.commission_percent,
    },
  });
}
