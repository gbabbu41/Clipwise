import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: barber } = await supabaseAdmin
    .from("barbers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

  const { searchParams } = new URL(request.url);
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
