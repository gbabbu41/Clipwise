import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { barberHasConflict, isDoubleBookError } from "@/lib/booking-conflict";
import { timeToMinutes } from "@/lib/utils";
import { isBookingInPast } from "@/lib/timezone";
import { ensureClientRow } from "@/lib/ensure-client";

/**
 * Accept a smart-waitlist request and assign it to an open calendar slot.
 *
 * The shop owner OR an active barber of the shop picks a barber + time on the
 * waiter's desired day; this books a confirmed appointment (conflict-checked),
 * marks the waitlist row "converted", clears the related in-app notifications,
 * and emails the customer a confirmation. Service-role so a barber (whom the
 * appointment_waitlist RLS doesn't grant update) can still convert the row,
 * after we verify they belong to the shop.
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
    duration_minutes?: number;
    total_amount?: number;
  };
  if (!b.waitlist_id || !b.barber_id || !b.time_slot) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const { data: wl } = await supabaseAdmin
    .from("appointment_waitlist")
    .select("id, shop_id, service_id, client_name, client_email, client_phone, desired_date, status")
    .eq("id", b.waitlist_id).maybeSingle();
  if (!wl) return NextResponse.json({ error: "Waitlist request not found" }, { status: 404 });
  if (wl.status === "converted") return NextResponse.json({ error: "Already assigned" }, { status: 409 });

  // Authorize: shop owner OR an active barber of this shop.
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id, name, slug, email, timezone").eq("id", wl.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  // Universal past-booking block (shop-timezone aware).
  if (isBookingInPast(wl.desired_date, b.time_slot, (shop as { timezone?: string | null }).timezone)) {
    return NextResponse.json({ error: "That time has already passed — please pick a future time." }, { status: 400 });
  }
  let allowed = shop.owner_id === user.id;
  if (!allowed) {
    const { data: barberRow } = await supabaseAdmin
      .from("barbers").select("id").eq("shop_id", wl.shop_id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
    allowed = !!barberRow;
  }
  if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  // Resolve service → duration + price (use overrides if provided).
  const serviceId = b.service_id || wl.service_id || null;
  let duration = b.duration_minutes && b.duration_minutes > 0 ? b.duration_minutes : 0;
  let amount = b.total_amount ?? 0;
  let serviceName = "";
  if (serviceId) {
    const { data: svc } = await supabaseAdmin.from("services").select("name, duration_minutes, price").eq("id", serviceId).maybeSingle();
    serviceName = svc?.name ?? "";
    if (!duration) duration = svc?.duration_minutes ?? 30;
    if (!amount) amount = svc?.price ?? 0;
  }
  if (!duration) duration = 30;

  const startMin = timeToMinutes(b.time_slot);
  const endMin = startMin + duration;

  if (await barberHasConflict(b.barber_id, wl.desired_date, startMin, endMin)) {
    return NextResponse.json({ error: "That slot was just taken — pick another." }, { status: 409 });
  }

  // Book it (confirmed). duration_minutes fallback for pre-phase14 shops.
  const baseRow = {
    shop_id: wl.shop_id,
    barber_id: b.barber_id,
    service_id: serviceId,
    client_name: wl.client_name,
    client_email: wl.client_email ?? null,
    client_phone: wl.client_phone ?? null,
    date: wl.desired_date,
    time_slot: b.time_slot,
    status: "confirmed",
    total_amount: amount,
    deposit_paid: false,
    payment_method: null,
    payment_status: null,
    notes: "From waitlist",
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
    return NextResponse.json({ error: "Couldn't book the appointment. Try again." }, { status: 500 });
  }

  // Stamp the permanent client link (phase 36) — best-effort.
  const linkedClientId = await ensureClientRow(wl.shop_id, { name: wl.client_name, email: wl.client_email, phone: wl.client_phone });
  if (linkedClientId) {
    await supabaseAdmin.from("appointments").update({ client_id: linkedClientId }).eq("id", inserted.data.id).then(null, () => null);
  }

  await supabaseAdmin.from("appointment_waitlist").update({ status: "converted" }).eq("id", wl.id);
  // Clear the "waitlist request" notifications now that it's handled (best-effort).
  await supabaseAdmin.from("notifications").update({ is_read: true })
    .eq("entity_type", "waitlist").eq("entity_id", wl.id).then(null, () => null);

  // Confirm to the customer (best-effort).
  if (wl.client_email) {
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
    fetch(`${origin}/api/send-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "booking_confirmation",
        data: {
          clientName: wl.client_name, clientEmail: wl.client_email,
          shopName: shop.name, shopEmail: shop.email ?? "", shopSlug: shop.slug,
          serviceName, date: wl.desired_date, time: b.time_slot,
          total: `$${Number(amount).toFixed(2)}`, paymentNote: "Pay in person at the shop",
          bookingId: inserted.data.id.slice(0, 8).toUpperCase(), appointmentId: inserted.data.id,
        },
      }),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, appointment_id: inserted.data.id });
}
