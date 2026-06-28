import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Today's WALK-IN queue for the shop. The `waitlist` table's RLS is owner-only,
 * so a barber can't read it directly — this returns it (service-role) after
 * verifying the caller is the shop owner OR an active barber. Barbers get back
 * their own `my_barber_id` so the UI can show just the walk-ins that chose them
 * (or "any" barber).
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json() as { shop_id?: string };
  if (!shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id").eq("id", shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const isOwner = shop.owner_id === user.id;
  let myBarberId: string | null = null;
  if (!isOwner) {
    const { data: barberRow } = await supabaseAdmin
      .from("barbers").select("id").eq("shop_id", shop_id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
    myBarberId = barberRow?.id ?? null;
  }
  if (!isOwner && !myBarberId) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: entries } = await supabaseAdmin
    .from("waitlist")
    .select("id, shop_id, barber_id, service_id, client_name, client_phone, added_at, status")
    .eq("shop_id", shop_id)
    .gte("added_at", today)
    .order("added_at");

  return NextResponse.json({ entries: entries ?? [], my_barber_id: myBarberId });
}
