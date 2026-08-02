import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Read-only availability + shop context for the AI voice server. Returns each
// barber's working hours and already-booked times per day as plain text the AI
// can read out — the AI proposes open times from it, and the booking endpoint +
// the DB double-booking trigger are the source of truth that reject conflicts.
//
// Secret-gated: only the trusted voice server (which holds AI_PHONE_SECRET) may
// call it. Fails closed if the secret isn't configured.

const to12h = (t?: string | null) => {
  if (!t) return "";
  const [hStr, m] = t.split(":");
  let h = parseInt(hStr, 10);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m ?? "00"} ${ap}`;
};

export async function POST(request: NextRequest) {
  const secret = process.env.AI_PHONE_SECRET;
  if (!secret || request.headers.get("x-ai-phone-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { shop_id, days } = await request.json().catch(() => ({})) as { shop_id?: string; days?: number };
  if (!shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });

  const [{ data: shop }, { data: services }, { data: barbers }] = await Promise.all([
    supabaseAdmin.from("shops").select("name, slug, booking_settings").eq("id", shop_id).maybeSingle(),
    supabaseAdmin.from("services").select("id, name, price, duration_minutes").eq("shop_id", shop_id).eq("is_active", true).order("price"),
    supabaseAdmin.from("barbers").select("id, name").eq("shop_id", shop_id).eq("is_active", true).order("name"),
  ]);
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const nDays = Math.min(Math.max(1, days ?? 7), 14);
  const base = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  const today = new Date();

  // Ask the tested public availability route for each day (parallel).
  const dayResults = await Promise.all(
    Array.from({ length: nDays }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
      return fetch(`${base}/api/availability`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id, date: iso }),
      })
        .then(r => (r.ok ? r.json() : { barbers: [] }))
        .then((j: { barbers?: Array<{ name: string; start_time: string | null; end_time: string | null; fullDayOff: boolean; busy: Array<{ time_slot: string }> }> }) => ({ iso, label, barbers: j.barbers ?? [] }))
        .catch(() => ({ iso, label, barbers: [] as [] }));
    }),
  );

  // Build a compact, readable summary the AI reads out and books against.
  const lines: string[] = [];
  for (const day of dayResults) {
    const open = day.barbers.filter(b => !b.fullDayOff && b.start_time && b.end_time);
    if (open.length === 0) { lines.push(`${day.label} (${day.iso}): closed / no availability.`); continue; }
    lines.push(`${day.label} (${day.iso}):`);
    for (const b of open) {
      const booked = (b.busy ?? []).map(x => x.time_slot).filter(Boolean);
      lines.push(`  ${b.name}: works ${to12h(b.start_time)}–${to12h(b.end_time)}${booked.length ? `, already booked at ${booked.join(", ")}` : ", fully open"}`);
    }
  }

  return NextResponse.json({
    shopName: shop.name,
    services: (services ?? []).map(s => ({ id: s.id, name: s.name, price: s.price, duration_minutes: s.duration_minutes })),
    barbers: (barbers ?? []).map(b => ({ id: b.id, name: b.name })),
    availabilityText: lines.join("\n"),
  });
}
