import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTwilio, sendSmsBestEffort, toE164 } from "@/lib/twilio";
import { ensureClientRow } from "@/lib/ensure-client";
import { isDoubleBookError } from "@/lib/booking-conflict";
import { prettyDate } from "@/lib/utils";

// Create a booking taken over the phone by the AI. Secret-gated (voice server
// only). Mirrors /api/book/in-person's insert; source='phone_ai', pay-in-person.
// The DB double-booking trigger is the source of truth — a taken slot is rejected
// with a friendly message the AI relays so it can offer another time.
export async function POST(request: NextRequest) {
  const secret = process.env.AI_PHONE_SECRET;
  if (!secret || request.headers.get("x-ai-phone-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const b = await request.json().catch(() => ({})) as {
    shop_id?: string; client_name?: string; client_phone?: string;
    service_id?: string; service_name?: string; barber_id?: string; barber_name?: string;
    date?: string; time?: string; ai_session_id?: string;
  };
  if (!b.shop_id || !b.client_name || !b.client_phone || !b.date || !b.time) {
    return NextResponse.json({ error: "Missing required booking details" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return NextResponse.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
  }

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, name, slug, phone, twilio_phone_number, booking_settings")
    .eq("id", b.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  // Resolve service (by id, else by name) for price + duration.
  let service: { id: string; name: string; price: number; duration_minutes: number | null } | null = null;
  if (b.service_id) {
    const { data } = await supabaseAdmin.from("services").select("id, name, price, duration_minutes").eq("id", b.service_id).maybeSingle();
    service = data;
  } else if (b.service_name) {
    const { data } = await supabaseAdmin.from("services").select("id, name, price, duration_minutes")
      .eq("shop_id", b.shop_id).eq("is_active", true).ilike("name", `%${b.service_name}%`).limit(1);
    service = data?.[0] ?? null;
  }

  // Resolve barber (by id, else by name; else leave null = any).
  let barberId: string | null = b.barber_id ?? null;
  let barberName: string | null = b.barber_name ?? null;
  if (!barberId && b.barber_name) {
    const { data } = await supabaseAdmin.from("barbers").select("id, name")
      .eq("shop_id", b.shop_id).eq("is_active", true).ilike("name", `%${b.barber_name}%`).limit(1);
    if (data?.[0]) { barberId = data[0].id; barberName = data[0].name; }
  }

  const total = Number(service?.price ?? 0);
  const duration = service?.duration_minutes ?? null;
  const baseRow: Record<string, unknown> = {
    shop_id: b.shop_id,
    barber_id: barberId,
    service_id: service?.id ?? null,
    client_name: b.client_name,
    client_phone: b.client_phone,
    date: b.date,
    time_slot: b.time,
    status: "confirmed",
    total_amount: total,
    payment_method: "cash",
    payment_status: "unpaid",
    source: "phone_ai",
  };

  // Insert; drop source (phase39) / duration_minutes (phase14) if a lagging
  // schema rejects them, so the booking still lands.
  const attempt = (row: Record<string, unknown>) =>
    supabaseAdmin.from("appointments").insert(row).select("id").single();
  let ins = await attempt({ ...baseRow, duration_minutes: duration });
  for (let i = 0; i < 2 && ins.error && /column|does not exist|schema cache/i.test(ins.error.message); i++) {
    const trimmed = { ...baseRow, duration_minutes: duration } as Record<string, unknown>;
    if (/duration_minutes/.test(ins.error.message)) delete trimmed.duration_minutes;
    if (/source/.test(ins.error.message)) delete trimmed.source;
    ins = await attempt(trimmed);
  }
  if (ins.error) {
    if (isDoubleBookError(ins.error)) {
      return NextResponse.json({ error: "That time was just taken — please offer the customer another time.", conflict: true }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't create the booking." }, { status: 500 });
  }
  const appointmentId = ins.data.id;

  // Permanent client link (best-effort).
  const linkedId = await ensureClientRow(b.shop_id, { name: b.client_name, phone: b.client_phone });
  if (linkedId) {
    await supabaseAdmin.from("appointments").update({ client_id: linkedId }).eq("id", appointmentId).then(null, () => null);
  }

  // Log the call as booked (best-effort).
  supabaseAdmin.from("call_logs").insert({
    shop_id: b.shop_id, caller_number: b.client_phone, outcome: "booked",
    ai_session_id: b.ai_session_id ?? null, appointment_id: appointmentId,
  }).then(null, () => null);

  // Confirmation SMS to the customer (from the shop's own number when it has one),
  // plus a best-effort alert to the shop line.
  const friendly = prettyDate(b.date);
  const svcName = service?.name ?? "your appointment";
  const clientMsg = `Booked! ${svcName}${barberName ? ` with ${barberName}` : ""} at ${shop.name} on ${friendly} at ${b.time}. See you then!`;
  const clientTo = toE164(b.client_phone);
  const twilio = getTwilio();
  if (clientTo && twilio && shop.twilio_phone_number) {
    twilio.messages.create({ to: clientTo, from: shop.twilio_phone_number, body: clientMsg }).then(null, () => null);
  } else {
    sendSmsBestEffort(b.client_phone, clientMsg, shop.name);
  }
  if (shop.phone) {
    sendSmsBestEffort(shop.phone, `📞 New AI phone booking: ${b.client_name} — ${svcName}${barberName ? ` with ${barberName}` : ""}, ${friendly} at ${b.time}.`, shop.name);
  }

  return NextResponse.json({
    ok: true,
    appointment_id: appointmentId,
    confirmation: `Booked ${svcName}${barberName ? ` with ${barberName}` : ""} for ${b.client_name} on ${friendly} at ${b.time}. A confirmation text is on the way.`,
  });
}
