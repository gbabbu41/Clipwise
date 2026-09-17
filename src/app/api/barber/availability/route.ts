import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeSchedule, validSchedule } from "@/lib/schedule-access";

async function getBarber(token: string, shopId: string | null) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  let query = supabaseAdmin.from("barbers").select("id").eq("user_id", user.id).eq("is_active", true);
  if (shopId) query = query.eq("shop_id", shopId);
  const { data: rows, error: readError } = await query.order("created_at", { ascending: true }).limit(1);
  if (readError) return { error: "Unable to load barber membership" };
  return rows?.[0] ?? null;
}

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = new URL(request.url).searchParams.get("shop_id");
  const barber = await getBarber(token, shopId);
  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });
  if ("error" in barber) return NextResponse.json({ error: barber.error }, { status: 503 });

  const { data: slots, error } = await supabaseAdmin
    .from("time_slots")
    .select("*")
    .eq("barber_id", barber.id)
    .order("day_of_week");

  if (error) return NextResponse.json({ error: "Unable to load availability" }, { status: 503 });
  return NextResponse.json({ slots: slots ?? [] });
}

export async function PUT(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = new URL(request.url).searchParams.get("shop_id");
  const barber = await getBarber(token, shopId);
  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });
  if ("error" in barber) return NextResponse.json({ error: barber.error }, { status: 503 });

  // Per-barber permission check: the owner can revoke this barber's
  // ability to edit their own schedule from the Staff page. Without this
  // guard a barber could still PUT manually after the toggle was flipped.
  const auth = await authorizeSchedule(token, barber.id, "edit_schedule");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const perms = (auth.barber.permissions ?? {}) as { edit_schedule?: boolean };
  // Default true when the column is absent or the field is unset.
  if (!auth.isOwner && perms.edit_schedule === false) {
    return NextResponse.json(
      { error: "Your shop owner has disabled schedule editing for you." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const slots = body?.slots as Array<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean }>;
  if (!Array.isArray(slots) || !validSchedule(slots.map(s => s && ({ day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time, is_open: s.is_available })), [])) return NextResponse.json({ error: "Invalid availability" }, { status: 400 });

  // Upsert each day's slot
  if (slots.length) {
    const { error } = await supabaseAdmin.from("time_slots").upsert(
      slots.map(slot => ({ barber_id: barber.id, day_of_week: slot.day_of_week, start_time: slot.start_time, end_time: slot.end_time, is_available: slot.is_available })),
      { onConflict: "barber_id,day_of_week" }
    );
    if (error) return NextResponse.json({ error: "Unable to save availability" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
