import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");
  let barberQuery = supabaseAdmin.from("barbers").select("id, shop_id, permissions").eq("user_id", user.id);
  if (shopId) barberQuery = barberQuery.eq("shop_id", shopId);
  const { data: barberRows } = await barberQuery.order("created_at", { ascending: true }).limit(1);
  const barber = barberRows?.[0];

  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

  // Enforce the owner's "view clients" permission toggle server-side — this route
  // backs the barber's My Clients page, and the nav only hides it, so without this
  // a barber could still fetch (or swipe to) their client list after the owner
  // turned it off. The owner is never restricted; undefined = allowed.
  const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id").eq("id", barber.shop_id).maybeSingle();
  const isOwner = shopRow?.owner_id === user.id;
  const perms = barber.permissions as { view_clients?: boolean } | null;
  if (!isOwner && perms?.view_clients === false) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabaseAdmin
    .from("appointments")
    .select("*, services(name, price, duration_minutes)")
    .eq("barber_id", barber.id)
    .order("time_slot", { ascending: true });

  if (date) {
    query = query.eq("date", date);
  } else if (from && to) {
    query = query.gte("date", from).lte("date", to);
  }

  const { data: appointments } = await query;
  return NextResponse.json({ appointments: appointments ?? [] });
}
