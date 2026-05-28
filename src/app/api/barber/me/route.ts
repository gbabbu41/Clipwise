import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: barber } = await supabaseAdmin
    .from("barbers")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!barber) return NextResponse.json({ error: "No barber record linked to this account" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("*")
    .eq("id", barber.shop_id)
    .single();

  return NextResponse.json({ barber, shop });
}
