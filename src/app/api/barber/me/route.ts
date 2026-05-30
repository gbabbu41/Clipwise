import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A user can be linked to multiple barber rows — one per shop they work at.
  const { data: barbers } = await supabaseAdmin
    .from("barbers")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (!barbers || barbers.length === 0) {
    return NextResponse.json({ error: "No barber record linked to this account" }, { status: 404 });
  }

  const shopIds = Array.from(new Set(barbers.map(b => b.shop_id)));
  const { data: shops } = await supabaseAdmin
    .from("shops")
    .select("*")
    .in("id", shopIds);

  // Return both the arrays AND the first pair for back-compat with single-shop callers
  return NextResponse.json({
    barbers,
    shops: shops ?? [],
    barber: barbers[0],
    shop: (shops ?? []).find(s => s.id === barbers[0].shop_id) ?? null,
  });
}
