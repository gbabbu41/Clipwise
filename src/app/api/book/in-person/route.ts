import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { barberHasConflict, findAvailableBarber, isDoubleBookError } from "@/lib/booking-conflict";
import { scheduleBlockReason } from "@/lib/schedule-block";
import { timeToMinutes } from "@/lib/utils";
import { fetchValidPromo, promoDiscount, promoBlockReason, consumePromo, type PromoRow } from "@/lib/promo";
import { resolveServiceCharge } from "@/lib/service-pricing";
import { authorizeShop, getBearer } from "@/lib/api-auth";
import { sendSmsBestEffort } from "@/lib/twilio";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isBookingInPast } from "@/lib/timezone";
import { effectivePlan } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { computeRedemption, deductRedeemedPoints } from "@/lib/loyalty-redeem";
import { ensureClientRow } from "@/lib/ensure-client";

/**
 * Create a pay-in-person (or no-charge) appointment server-side.
 *
 * The customer booking page is anonymous; the appointments RLS lets anon INSERT
 * but NOT SELECT, so the old client-side clash check was blind and let two
 * customers grab the same slot. This route runs the conflict check with the
 * service-role client (sees real bookings), resolves "Any Available" to a
 * concrete free barber, and lets the DB unique index backstop the exact-slot
 * race. Money is never touched here (in-person / unpaid).
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "book-in-person", 12, 60_000);
  if (limited) return limited;

  const b = await request.json() as {
    shop_id: string;
    barber_id?: string | null;       // null / "any" → auto-resolve
    service_id: string;              // primary service
    service_ids?: string[];          // full multiset — server recomputes the real price from these
    service_names?: string;          // "Haircut + Beard" for the multi-service note
    duration_minutes?: number;       // combined block length
    client_name: string;
    client_email?: string;
    client_phone?: string;
    date: string;                    // YYYY-MM-DD
    time_slot: string;               // "9:00 AM"
    total_amount: number;
    subtotal?: number;               // pre-discount total (for server-side promo math)
    promo_code?: string;             // validated + consumed server-side
    pay_in_person?: boolean;         // tag the row as cash/unpaid
    confirmed?: boolean;             // owner-booked → skip the approval queue
    note?: string;                   // extra note (e.g. "outside working hours")
    redeem?: boolean;                // customer chose to spend loyalty points (amount computed server-side)
  };

  if (!b.shop_id || !b.service_id || !b.client_name || !b.date || !b.time_slot) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Shop must exist + be live; read auto-confirm fresh (server is the source of truth).
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, status, booking_settings, owner_id, timezone, subscription_plan, subscription_status").eq("id", b.shop_id).maybeSingle();
  if (!shop || (shop.status !== "approved")) {
    return NextResponse.json({ error: "This shop isn't accepting bookings." }, { status: 403 });
  }

  // Universal past-booking block (server-authoritative, shop-timezone aware): no
  // one — customer OR staff — can book a slot that's already passed.
  if (isBookingInPast(b.date, b.time_slot, (shop as { timezone?: string | null }).timezone)) {
    return NextResponse.json({ error: "That time has already passed — please pick a future time." }, { status: 400 });
  }

  // The `confirmed` flag (skip approval queue + bypass the pause switch) is
  // owner/staff-only. Honor it ONLY for an authenticated owner or active barber
  // of this shop — an anonymous customer can't self-confirm or bypass the pause
  // by POSTing confirmed:true.
  let callerIsStaff = false;
  if (b.confirmed && getBearer(request)) {
    const auth = await authorizeShop(request, b.shop_id);
    callerIsStaff = !("error" in auth);
  }
  const confirmed = !!b.confirmed && callerIsStaff;

  // Emergency pause — block customer self-bookings, but still let staff add
  // walk-ins manually from the dashboard (confirmed = authenticated owner/barber).
  if (!confirmed && (shop.booking_settings as { bookings_paused?: boolean } | null)?.bookings_paused) {
    return NextResponse.json({ error: "This shop isn't accepting bookings right now." }, { status: 403 });
  }
  const autoConfirm = !!(shop.booking_settings as { auto_confirm?: boolean } | null)?.auto_confirm;

  // ── Promo code (server-authoritative) ──────────────────────────────────────
  // Validate the code, enforce the cap + once-per-customer, and recompute the
  // discount from the subtotal. The consume happens after the appointment is
  // created (so a redemption always links to a real booking).
  // ── Server-authoritative price + duration (NEVER trust client amounts) ──────
  // Sum the REAL prices/durations from the DB for the selected services, scoped
  // to this shop, so a client can't POST a fake total_amount or reference
  // another shop's cheaper service.
  const requestedServiceIds = (Array.isArray(b.service_ids) && b.service_ids.length) ? b.service_ids : [b.service_id];
  const charge = await resolveServiceCharge(b.shop_id, requestedServiceIds);
  if (!charge.allResolved || charge.count === 0) {
    return NextResponse.json({ error: "One or more selected services are unavailable." }, { status: 400 });
  }

  let validPromo: PromoRow | null = null;
  let effectiveTotal = charge.subtotal;
  if (b.promo_code) {
    validPromo = await fetchValidPromo(b.shop_id, b.promo_code);
    if (!validPromo) return NextResponse.json({ error: "Invalid or expired promo code." }, { status: 400 });
    const blocked = await promoBlockReason(validPromo, b.client_email, b.client_phone);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
    effectiveTotal = Math.max(0, charge.subtotal - promoDiscount(validPromo, charge.subtotal));
  }

  // ── Loyalty redemption (server-authoritative) — applied after any promo. The
  // client only sends a boolean; the discount + points come from the customer's
  // real balance. Points are deducted after the appointment is created.
  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  const redemption = await computeRedemption({
    shopId: b.shop_id, plan, bookingSettings: shop.booking_settings,
    email: b.client_email, phone: b.client_phone,
    preTaxTotal: effectiveTotal, requested: !!b.redeem,
  });
  effectiveTotal = Math.max(0, effectiveTotal - redemption.discount);

  // Duration → conflict window (server value).
  const startMin = timeToMinutes(b.time_slot);
  const duration = charge.duration > 0 ? charge.duration : 30;
  const endMin = startMin + duration;

  // Resolve barber + conflict check (service-role → sees real bookings).
  let barberId = b.barber_id && b.barber_id !== "any" ? b.barber_id : null;
  if (barberId) {
    if (await barberHasConflict(barberId, b.date, startMin, endMin)) {
      return NextResponse.json({ error: "Sorry, that time was just booked. Please pick another slot." }, { status: 409 });
    }
  } else {
    barberId = await findAvailableBarber(b.shop_id, b.date, startMin, endMin);
    if (!barberId) {
      return NextResponse.json({ error: "Sorry, that time is fully booked. Please pick another slot." }, { status: 409 });
    }
  }

  // Don't book over a block / time-off. Approved blocked-hours that overlap the
  // window, or any full-day off (day_off/vacation/sick), make the slot unbookable
  // — even for an owner-added appointment (unblock first to override). A recurring
  // break is enforced only for a CUSTOMER self-booking; an owner/staff adding a
  // walk-in from the dashboard may deliberately squeeze someone in over a break.
  const blockReason = await scheduleBlockReason(
    b.shop_id, barberId, b.date, startMin, endMin, { includeBreaks: !callerIsStaff },
  );
  if (blockReason) {
    return NextResponse.json({ error: blockReason }, { status: 409 });
  }

  // Owner-initiated bookings (b.confirmed) skip approval; customer self-bookings
  // still respect the shop's auto-confirm setting.
  const status = (confirmed || autoConfirm) ? "confirmed" : "pending";
  const noteParts = [b.note, b.service_names ? `Services: ${b.service_names}` : null].filter(Boolean);
  const baseRow = {
    shop_id: b.shop_id,
    barber_id: barberId,
    service_id: b.service_id,
    client_name: b.client_name,
    client_email: b.client_email ?? null,
    client_phone: b.client_phone ?? null,
    date: b.date,
    time_slot: b.time_slot,
    status,
    total_amount: effectiveTotal,
    deposit_paid: false,
    payment_method: b.pay_in_person ? "cash" : null,
    payment_status: b.pay_in_person ? "unpaid" : null,
    notes: noteParts.length ? noteParts.join(" · ") : null,
  };

  // Insert with duration_minutes; if the column doesn't exist yet (pre-phase14),
  // retry without it so booking still works (occupancy degrades to the primary
  // service duration until the migration is run).
  let inserted = await supabaseAdmin
    .from("appointments").insert({ ...baseRow, duration_minutes: duration }).select("id, status, barber_id").single();
  if (inserted.error && /duration_minutes/.test(inserted.error.message)) {
    inserted = await supabaseAdmin
      .from("appointments").insert(baseRow).select("id, status, barber_id").single();
  }

  if (inserted.error) {
    // The DB rejected a double-book (exact-slot unique index OR the overlap guard).
    if (isDoubleBookError(inserted.error)) {
      return NextResponse.json({ error: "That time was just booked — please pick another slot." }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't create the booking. Please try again." }, { status: 500 });
  }

  // Consume the promo now that the appointment exists (draws down the cap +
  // records the redemption so this customer can't reuse it). Best-effort.
  if (validPromo) {
    await consumePromo(validPromo, b.shop_id, b.client_email ?? null, b.client_phone ?? null, inserted.data.id);
  }

  // Spend redeemed loyalty points (discount already reflected in total_amount).
  // Best-effort — never roll back a real booking over a points-ledger hiccup.
  if (redemption.points > 0) {
    await deductRedeemedPoints({
      shopId: b.shop_id, email: b.client_email, phone: b.client_phone,
      points: redemption.points, appointmentId: inserted.data.id,
    });
  }

  // Resolve/create the client (when we have an email/phone) and stamp the
  // appointment with a permanent client_id link (phase 36). Best-effort — a
  // no-op if the column isn't there yet or it's a name-only walk-in.
  const linkedClientId = await ensureClientRow(b.shop_id, { name: b.client_name, email: b.client_email, phone: b.client_phone });
  if (linkedClientId) {
    await supabaseAdmin.from("appointments").update({ client_id: linkedClientId }).eq("id", inserted.data.id).then(null, () => null);
  }

  // Alert the shop SERVER-SIDE — in-app notifications for the owner + assigned
  // barber (these drive the live portal pop-up + chime) AND the SMS to them.
  // This used to be a fire-and-forget fetch from the CUSTOMER's browser, so a
  // customer who closed the tab right after seeing "Confirmed" (or a mobile
  // connection blip) left the shop with NO alert for a real booking. Doing it
  // here — mirroring the online path in finalize-booking-session — makes staff
  // alerting independent of the customer's browser. Only for customer
  // self-bookings: a staff-added walk-in shouldn't ping the owner about their
  // own entry (same gate as the customer SMS below). Awaited so it completes
  // before this serverless invocation returns; notify-staff is internally
  // best-effort and never throws.
  if (!callerIsStaff) {
    const notifyOrigin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
    if (notifyOrigin) {
      await fetch(`${notifyOrigin}/api/appointments/notify-staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: inserted.data.id, notify_owner: true }),
      }).catch(() => null);
    }
  }

  // Text the customer their confirmation (server-side, best-effort). Only for
  // customer self-bookings — staff-added walk-ins don't auto-text (unchanged
  // behavior). Sent here, not from the public page, so /api/twilio/send-sms can
  // require auth (no open SMS relay).
  if (!callerIsStaff && b.client_phone) {
    const ref = inserted.data.id.slice(0, 8).toUpperCase();
    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
    const manageLink = `${origin}/my-booking/${inserted.data.id}`;
    const shopName = (shop as { name?: string }).name ?? "the shop";
    const smsBody = inserted.data.status === "pending"
      ? `Thanks! Your booking request at ${shopName} for ${b.date} at ${b.time_slot} was received — we'll text you once it's confirmed. Ref #${ref}. Manage: ${manageLink}`
      : `Your appointment on ${b.date} at ${b.time_slot} is confirmed. Booking #${ref}. Manage: ${manageLink}`;
    await sendSmsBestEffort(b.client_phone, smsBody, shopName);
  }

  return NextResponse.json({
    id: inserted.data.id,
    status: inserted.data.status,
    barber_id: inserted.data.barber_id,
  });
}
