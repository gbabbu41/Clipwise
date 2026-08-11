import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { computeBarberEarnings } from "@/lib/barber-earnings";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");
  let barberQuery = supabaseAdmin.from("barbers").select("id, shop_id, commission_percent, permissions, is_active").eq("user_id", user.id);
  if (shopId) barberQuery = barberQuery.eq("shop_id", shopId);
  const { data: barberRows } = await barberQuery.order("created_at", { ascending: true }).limit(1);
  const barber = barberRows?.[0];

  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });
  // Suspended barbers can't pull earnings via the API either (not just the UI).
  if (barber.is_active === false) return NextResponse.json({ error: "Account suspended" }, { status: 403 });

  // Is this person the shop owner? Kept for LABELLING only now — an owner who
  // cuts uses their own configured commission (default 100%, editable on the
  // Staff page) so they can split personal barber wage vs business profit (e.g.
  // for taxes). Whatever isn't the barber's cut stays in their business.
  const effShopId = shopId ?? barber.shop_id;
  let isOwner = false;
  if (effShopId) {
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id").eq("id", effShopId).maybeSingle();
    isOwner = shopRow?.owner_id === user.id;
  }

  // Enforce the owner's "view earnings" permission toggle server-side — the nav
  // only hides the tab, so without this a barber could hit this route (or swipe
  // to /earnings) and read their pay data after the owner turned it off. The
  // owner themselves is never restricted. Undefined = allowed (matches the nav).
  const perms = barber.permissions as { view_earnings?: boolean } | null;
  if (!isOwner && perms?.view_earnings === false) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const commissionPercent = barber.commission_percent;

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

  // Earnings math lives in ONE place (src/lib/barber-earnings) so the owner's
  // Payments page — when filtered to this barber — shows the identical numbers.
  // computeBarberEarnings excludes refunded rows and keeps the same 50/50 card-fee
  // split as before (commission + tips − barber's half of the fee = take-home).
  const list = (transactions ?? []).filter(t => !t.refunded);
  const e = computeBarberEarnings(transactions ?? [], commissionPercent);

  return NextResponse.json({
    transactions: list,
    summary: {
      revenue: e.revenue,
      commission: e.commission,
      tips: e.tips,
      stripeFee: e.stripeFee,
      barberFeeShare: e.barberFeeShare,
      youKeep: e.youKeep,
      shopKeeps: e.shopKeeps,
      isOwner,
      count: e.count,
      avgTicket: e.avgTicket,
      commissionPercent,
    },
  });
}
