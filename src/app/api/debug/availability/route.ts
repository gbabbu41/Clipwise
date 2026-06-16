import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * TEMPORARY diagnostic — dumps a shop's barbers + their raw time_slots rows so we
 * can see exactly what schedule is stored (e.g. is a 6:30 AM start actually
 * saved). Read-only, schedule hours only (no customer PII).
 *
 *   GET /api/debug/availability?slug=<shopslug>&date=YYYY-MM-DD
 *
 * Remove once the schedule issue is diagnosed.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!slug) {
    return NextResponse.json({ error: "Pass ?slug=<shopslug>&date=YYYY-MM-DD" }, { status: 400 });
  }

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, booking_settings").eq("slug", slug).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found for that slug" }, { status: 404 });

  const dow = new Date(date + "T00:00:00").getDay();
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow];

  const { data: barbers } = await supabaseAdmin
    .from("barbers").select("id, name, is_active").eq("shop_id", shop.id).order("name");
  const ids = (barbers ?? []).map(b => b.id);

  const { data: allSlots } = await supabaseAdmin
    .from("time_slots")
    .select("barber_id, day_of_week, start_time, end_time, is_available")
    .in("barber_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

  const result = (barbers ?? []).map(b => {
    const rows = (allSlots ?? []).filter(s => s.barber_id === b.id);
    return {
      name: b.name,
      is_active: b.is_active,
      total_time_slot_rows: rows.length,
      rows_for_this_day: rows.filter(s => s.day_of_week === dow),
      all_rows: rows,
    };
  });

  return NextResponse.json({
    shop: shop.name,
    date,
    weekday_index: dow,
    weekday: dayName,
    slot_interval_minutes: (shop.booking_settings as { slot_interval_minutes?: number } | null)?.slot_interval_minutes ?? "(default 30)",
    barbers: result,
  }, { status: 200 });
}
