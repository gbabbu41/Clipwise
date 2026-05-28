import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getBarber(token: string) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id").eq("user_id", user.id).maybeSingle();
  return barber;
}

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const barber = await getBarber(token);
  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

  const { data: slots } = await supabaseAdmin
    .from("time_slots")
    .select("*")
    .eq("barber_id", barber.id)
    .order("day_of_week");

  return NextResponse.json({ slots: slots ?? [] });
}

export async function PUT(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const barber = await getBarber(token);
  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

  const { slots } = await request.json() as {
    slots: Array<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean }>
  };

  // Upsert each day's slot
  for (const slot of slots) {
    await supabaseAdmin.from("time_slots").upsert(
      { barber_id: barber.id, ...slot },
      { onConflict: "barber_id,day_of_week" }
    );
  }

  return NextResponse.json({ ok: true });
}
