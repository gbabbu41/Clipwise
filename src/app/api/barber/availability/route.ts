import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getBarber(token: string, shopId: string | null) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  let query = supabaseAdmin.from("barbers").select("id").eq("user_id", user.id);
  if (shopId) query = query.eq("shop_id", shopId);
  const { data: rows } = await query.order("created_at", { ascending: true }).limit(1);
  return rows?.[0] ?? null;
}

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = new URL(request.url).searchParams.get("shop_id");
  const barber = await getBarber(token, shopId);
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

  const shopId = new URL(request.url).searchParams.get("shop_id");
  const barber = await getBarber(token, shopId);
  if (!barber) return NextResponse.json({ error: "No barber record" }, { status: 404 });

  // Per-barber permission check: the owner can revoke this barber's
  // ability to edit their own schedule from the Staff page. Without this
  // guard a barber could still PUT manually after the toggle was flipped.
  const { data: permsRow } = await supabaseAdmin
    .from("barbers").select("permissions").eq("id", barber.id).single();
  const perms = (permsRow?.permissions ?? {}) as { edit_schedule?: boolean };
  // Default true when the column is absent or the field is unset.
  if (perms.edit_schedule === false) {
    return NextResponse.json(
      { error: "Your shop owner has disabled schedule editing for you." },
      { status: 403 }
    );
  }

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
