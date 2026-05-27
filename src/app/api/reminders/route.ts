import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// POST /api/reminders
// Sends 24-hour reminder emails for appointments scheduled tomorrow.
// Call this from a cron job daily (e.g. at 10 AM).
// Requires CRON_SECRET header to prevent unauthorized calls.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Build tomorrow's date string
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // Fetch all pending/confirmed appointments for tomorrow with shop info
  const { data: appointments, error } = await supabaseAdmin
    .from("appointments")
    .select("id, client_name, client_email, client_phone, date, time_slot, total_amount, shops(name, slug), barbers(name), services(name)")
    .eq("date", tomorrowStr)
    .in("status", ["pending", "confirmed"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const appts = (appointments ?? []) as unknown as Array<{
    id: string;
    client_name: string;
    client_email: string;
    time_slot: string;
    total_amount: number;
    shops: { name: string; slug: string } | null;
    barbers: { name: string } | null;
    services: { name: string } | null;
  }>;

  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  let sent = 0;
  let skipped = 0;

  for (const appt of appts) {
    if (!appt.client_email || !appt.shops) { skipped++; continue; }

    await fetch(`${BASE_URL}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "appointment_reminder",
        data: {
          clientName: appt.client_name,
          clientEmail: appt.client_email,
          shopName: appt.shops.name,
          barberName: appt.barbers?.name ?? "Your barber",
          serviceName: appt.services?.name ?? "Your service",
          date: tomorrowStr,
          time: appt.time_slot,
          total: `$${Number(appt.total_amount).toFixed(2)}`,
          bookingId: appt.id.slice(0, 8).toUpperCase(),
          slug: appt.shops.slug,
        },
      }),
    }).catch(() => null);

    sent++;
  }

  return NextResponse.json({ success: true, sent, skipped, date: tomorrowStr });
}

// GET /api/reminders — returns count of tomorrow's appointments (useful for admin)
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const { count } = await supabaseAdmin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("date", tomorrowStr)
    .in("status", ["pending", "confirmed"]);

  return NextResponse.json({ date: tomorrowStr, appointments: count ?? 0 });
}
