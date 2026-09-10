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
  // computeBarberEarnings excludes refunded rows. Take-home is commission + tips
  // with NO card fee deducted: the shop bears Stripe processing entirely, so the
  // barber portal never touches the fee (it shows on the shop's Payments layer).
  // No-show penalty fees aren't a service the barber performed — they're a shop
  // penalty charge — so they don't pay commission or count as the barber's
  // earnings. Exclude them from both the totals and the returned list.
  const isNoShowFee = (t: { source?: string | null; service_name?: string | null }) =>
    t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee");
  const list = (transactions ?? []).filter(t => !t.refunded && !isNoShowFee(t));

  // Owner on their own chair keeps 100% (their cuts are shop profit, so their
  // stored commission is 0 — see barber-earnings header). Everyone else uses
  // their configured rate.
  const e = computeBarberEarnings(list, commissionPercent, isOwner);

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
      // Report 100% for the owner's own chair so the portal label reads "you keep
      // 100%" (stored is 0, meaning "no commission expense" on the shop side).
      commissionPercent: isOwner ? 100 : commissionPercent,
    },
  });
}
