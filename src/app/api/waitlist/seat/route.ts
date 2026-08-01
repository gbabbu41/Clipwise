import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { barberHasConflict, isDoubleBookError } from "@/lib/booking-conflict";
import { timeToMinutes, prettyDate } from "@/lib/utils";
import { sendSmsBestEffort } from "@/lib/twilio";
import { isBookingInPast } from "@/lib/timezone";
import { ensureClientRow } from "@/lib/ensure-client";

/**
 * Seat a WALK-IN queue entry (the `waitlist` table) onto today's schedule.
 *
 * The shop owner OR an active barber picks a barber + open slot; this books a
 * confirmed appointment for today (conflict-checked) and flips the queue row to
 * "called". Service-role so a barber (whom the owner-only `waitlist` RLS doesn't
 * let read/update) can still seat their own walk-ins, after we verify they
 * belong to the shop. A barber may only seat themselves; the owner, anyone.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await request.json() as {
    waitlist_id: string;
    barber_id: string;
    time_slot: string;             // "9:30 AM"
    service_id?: string | null;
  };
  if (!b.waitlist_id || !b.barber_id || !b.time_slot) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // select * so client_email comes through once phase17 is run (no error before).
  const { data: wl } = await supabaseAdmin
    .from("waitlist")
    .select("*")
    .eq("id", b.waitlist_id).maybeSingle();
  if (!wl) return NextResponse.json({ error: "Walk-in not found" }, { status: 404 });
  if (wl.status === "served" || wl.status === "removed") {
    return NextResponse.json({ error: "That walk-in is already finished" }, { status: 409 });
  }
  const clientEmail = (wl as { client_email?: string | null }).client_email ?? null;

  // Authorize: shop owner OR an active barber of this shop. A barber may only
  // seat to themselves (the owner/front desk can assign to anyone).
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id, name, slug, email, timezone").eq("id", wl.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const isOwner = shop.owner_id === user.id;
  let callerBarberId: string | null = null;
  if (!isOwner) {
    const { data: barberRow } = await supabaseAdmin
      .from("barbers").select("id").eq("shop_id", wl.shop_id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
    callerBarberId = barberRow?.id ?? null;
  }
  if (!isOwner && !callerBarberId) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!isOwner && callerBarberId !== b.barber_id) {
    return NextResponse.json({ error: "You can only seat a walk-in to yourself." }, { status: 403 });
  }

  // Resolve service → duration + price + name.
  const serviceId = b.service_id || wl.service_id || null;
  let duration = 0;
  let amount = 0;
  let serviceName = "";
  if (serviceId) {
    const { data: svc } = await supabaseAdmin.from("services").select("name, duration_minutes, price").eq("id", serviceId).maybeSingle();
    serviceName = svc?.name ?? "";
    duration = svc?.duration_minutes ?? 30;
    amount = svc?.price ?? 0;
  }
  if (!duration) duration = 30;

  const today = new Date().toISOString().slice(0, 10);
  const startMin = timeToMinutes(b.time_slot);
  const endMin = startMin + duration;

  // Universal past-booking block (shop-timezone aware) — no seating into a passed slot.
  if (isBookingInPast(today, b.time_slot, (shop as { timezone?: string | null }).timezone)) {
    return NextResponse.json({ error: "That time has already passed — please pick a current or later time." }, { status: 400 });
  }

  if (await barberHasConflict(b.barber_id, today, startMin, endMin)) {
    return NextResponse.json({ error: "That slot was just taken — pick another." }, { status: 409 });
  }

  const baseRow = {
    shop_id: wl.shop_id,
    barber_id: b.barber_id,
    service_id: serviceId,
    client_name: wl.client_name,
    client_phone: wl.client_phone ?? null,
    client_email: clientEmail,
    date: today,
    time_slot: b.time_slot,
    status: "confirmed",
    total_amount: amount,
    notes: "Walk-in from waitlist",
  };
  let inserted = await supabaseAdmin
    .from("appointments").insert({ ...baseRow, duration_minutes: duration }).select("id").single();
  if (inserted.error && /duration_minutes/.test(inserted.error.message)) {
    inserted = await supabaseAdmin.from("appointments").insert(baseRow).select("id").single();
  }
  if (inserted.error) {
    if (isDoubleBookError(inserted.error)) {
      return NextResponse.json({ error: "That slot was just taken — pick another." }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't seat the walk-in. Try again." }, { status: 500 });
  }

  // Stamp the permanent client link (phase 36) — best-effort.
  const linkedClientId = await ensureClientRow(wl.shop_id, { name: wl.client_name, email: clientEmail, phone: wl.client_phone });
  if (linkedClientId) {
    await supabaseAdmin.from("appointments").update({ client_id: linkedClientId }).eq("id", inserted.data.id).then(null, () => null);
  }

  await supabaseAdmin.from("waitlist")
    .update({ status: "called", barber_id: b.barber_id, service_id: serviceId })
    .eq("id", wl.id);

  // Tell the customer they're up — text + email, both best-effort.
  const { data: barberRow } = await supabaseAdmin.from("barbers").select("name").eq("id", b.barber_id).maybeSingle();
  const barberName = barberRow?.name ?? "your barber";
  await sendSmsBestEffort(wl.client_phone ?? null, `You're up at ${shop.name}! ${barberName} can see you at ${b.time_slot}. See you soon.`, shop.name);
  if (clientEmail) {
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
    fetch(`${origin}/api/send-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "booking_confirmation",
        data: {
          clientName: wl.client_name, clientEmail,
          shopId: wl.shop_id, shopName: shop.name, shopEmail: shop.email ?? "", shopSlug: shop.slug,
          barberName, serviceName: serviceName || "Walk-in",
          date: prettyDate(today), time: b.time_slot,
          total: `$${Number(amount).toFixed(2)}`, paymentNote: "Pay in person at the shop",
          bookingId: inserted.data.id.slice(0, 8).toUpperCase(), appointmentId: inserted.data.id,
        },
      }),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, appointment_id: inserted.data.id });
}
