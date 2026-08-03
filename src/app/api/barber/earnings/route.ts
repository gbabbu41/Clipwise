import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");
  let barberQuery = supabaseAdmin.from("barbers").select("id, shop_id, commission_percent, permissions").eq("user_id", user.id);
  if (shopId) barberQuery = barberQuery.eq("shop_id", shopId);
  const { data: barberRows } = await barberQuery.order("created_at", { ascending: true }).limit(1);
  const barber = barberRows?.[0];

  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

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

  // Exclude refunded transactions — a refunded charge must not keep inflating
  // revenue/commission/tips/count. Filter in JS (not .neq) so rows where
  // `refunded` is null/absent are kept.
  const list = (transactions ?? []).filter(t => !t.refunded);
  const tips = list.reduce((s, t) => s + (t.tip ?? 0), 0);
  const serviceAmount = list.reduce((s, t) => s + t.amount, 0);
  const revenue = serviceAmount + tips;
  // Service-commission portion (no tips) — driven by the barber's own commission
  // rate. For an owner at 100% this equals the whole service amount (unchanged);
  // an owner who sets e.g. 50% keeps half here and the rest is business profit.
  const commission = list.reduce((s, t) => s + (t.commission_amount ?? (t.amount * commissionPercent) / 100), 0);
  // Card processing fee is split 50/50 with the shop. Real fee stored per card
  // transaction (phase38); cash sales have 0. The barber covers half.
  const stripeFee = list.reduce((s, t) => s + (t.stripe_fee ?? 0), 0);
  const barberFeeShare = stripeFee / 2;
  // Take-home = service commission + all tips − the barber's half of the card fee.
  // The remainder (service minus commission minus the shop's own half of the fee)
  // is the shop/business cut.
  const youKeep = Math.max(0, commission + tips - barberFeeShare);
  const shopKeeps = Math.max(0, serviceAmount - commission - barberFeeShare);

  return NextResponse.json({
    transactions: list,
    summary: {
      revenue,
      commission,
      tips,
      stripeFee,
      barberFeeShare,
      youKeep,
      shopKeeps,
      isOwner,
      count: list.length,
      avgTicket: list.length ? revenue / list.length : 0,
      commissionPercent,
    },
  });
}
