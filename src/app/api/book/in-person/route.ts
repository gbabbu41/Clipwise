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
import { isBookingInPast, isBeyondAdvanceWindow } from "@/lib/timezone";
import { effectivePlan, planHasFeature, isPaidPlan, clampLen, FIELD_CAPS } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { computeRedemption, deductRedeemedPoints } from "@/lib/loyalty-redeem";
import { redeemGift } from "@/lib/gift-redeem";
import { taxCents, combinedTaxRate, type TaxConfig } from "@/lib/pricing";
import { ensureClientRow } from "@/lib/ensure-client";
import { sendNewBookingStaffEmails, sendCustomerBookingEmail } from "@/lib/notify-booking-emails";

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
    override_block?: boolean;        // staff confirmed booking over a break/time-off (honored only for authenticated staff)
    note?: string;                   // extra note (e.g. "outside working hours")
    redeem?: boolean;                // customer chose to spend loyalty points (amount computed server-side)
    gift_code?: string;              // gift card that covers this booking (applied server-side)
  };

  if (!b.shop_id || !b.service_id || !b.client_name || !b.date || !b.time_slot) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Cap every free-text field from this PUBLIC / anonymous route. SQL injection
  // isn't possible here — Supabase sends values as parameters, never concatenated
  // into SQL — so a "code" in a name is just stored as literal text. The real
  // abuse vector is an UNBOUNDED payload (someone POSTing megabytes of text to
  // bloat the DB), so bound the length before anything touches the database.
  b.client_name = String(b.client_name).slice(0, 100);
  if (b.client_email) b.client_email = String(b.client_email).slice(0, 200);
  if (b.client_phone) b.client_phone = String(b.client_phone).slice(0, 30);
  if (b.note) b.note = String(b.note).slice(0, 500);
  if (b.service_names) b.service_names = String(b.service_names).slice(0, 200);

  // Shop must exist + be live; read auto-confirm fresh (server is the source of truth).
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, status, booking_settings, owner_id, timezone, subscription_plan, subscription_status, allow_pay_in_person, stripe_connected, stripe_account_id").eq("id", b.shop_id).maybeSingle();
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

  // ── Server enforcement of the shop's pay-model + advance window ────────────
  // These are enforced on the client booking page too, but a crafted/replayed
  // POST could bypass that — so re-check here (the server is the source of truth).
  // Staff-added walk-ins (callerIsStaff) are exempt from both.
  const shopCanCharge = planHasFeature(plan, "payments")
    && !!(shop as { stripe_connected?: boolean | null }).stripe_connected
    && !!(shop as { stripe_account_id?: string | null }).stripe_account_id;
  const noShowProtection = !!(shop.booking_settings as { no_show_protection?: boolean } | null)?.no_show_protection;
  const cardRequired = noShowProtection && shopCanCharge && effectiveTotal > 0;
  const allowInPerson = !cardRequired
    && ((shop as { allow_pay_in_person?: boolean | null }).allow_pay_in_person !== false || !shopCanCharge);
  if (!callerIsStaff && b.pay_in_person && !allowInPerson) {
    return NextResponse.json({ error: "This shop requires a card to book online." }, { status: 403 });
  }
  // Advance-booking window — can't book past today + advance_days (shop tz).
  const advanceDays = Number((shop.booking_settings as { advance_days?: number } | null)?.advance_days ?? 15);
  if (!callerIsStaff && isBeyondAdvanceWindow(b.date, advanceDays, (shop as { timezone?: string | null }).timezone)) {
    return NextResponse.json({ error: "That date is beyond this shop's booking window." }, { status: 400 });
  }

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

  // Schedule enforcement. A DELIBERATE block matters: approved time-off
  // (day_off/vacation/sick), blocked-hours, or a recurring break (lunch). A
  // regular off-day / outside-working-hours is NOT flagged here — staff (and the
  // customer availability path) treat those separately.
  //   · Customer self-booking  → hard block (the schedule governs the public page).
  //   · Staff walk-in          → also blocked, UNLESS they explicitly confirmed
  //     ("book anyway") via override_block. The client shows a warning first and
  //     retries with the flag set. `blocked: true` tells the client this 409 is
  //     an overridable schedule conflict (vs a hard double-booking conflict).
  // The flag is honored ONLY for authenticated staff — a customer can't send it.
  const staffOverride = callerIsStaff && b.override_block === true;
  if (!staffOverride) {
    const blockReason = await scheduleBlockReason(
      b.shop_id, barberId, b.date, startMin, endMin, { includeBreaks: true },
    );
    if (blockReason) {
      return NextResponse.json({ error: blockReason, blocked: true }, { status: 409 });
    }
  }

  // Owner-initiated bookings (b.confirmed) skip approval; customer self-bookings
  // still respect the shop's auto-confirm setting.
  const status = (confirmed || autoConfirm) ? "confirmed" : "pending";
  const noteParts = [b.note, b.service_names ? `Services: ${b.service_names}` : null].filter(Boolean);
  // Store the GROSS total (service + sales tax) like the card + gift-card paths,
  // so the shop portal shows the real amount the customer owes at the shop — not
  // the pre-tax subtotal. tax is 0 for shops that aren't tax-registered
  // (combinedTaxRate returns 0 then). tax_amount is stamped best-effort after the
  // insert (mirrors the gift path) so a pre-tax-column prod can never fail the
  // booking.
  const inPersonTaxCfg = (shop.booking_settings ?? {}) as TaxConfig;
  // Tax is a paid-plan feature — a Starter (cash-only) shop never charges it, no
  // matter what's stored in booking_settings (kept intact for when they upgrade).
  const inPersonTax = taxCents(Math.round(effectiveTotal * 100), isPaidPlan(plan) ? combinedTaxRate(inPersonTaxCfg) : 0) / 100;
  const grossTotal = Math.round((effectiveTotal + inPersonTax) * 100) / 100;
  const baseRow = {
    shop_id: b.shop_id,
    barber_id: barberId,
    service_id: b.service_id,
    // Clamp public free-text to the DB caps so an oversized value truncates
    // cleanly instead of tripping the CHECK constraint and 500-ing the booking.
    client_name: clampLen(b.client_name, FIELD_CAPS.client_name),
    client_email: clampLen(b.client_email ?? null, FIELD_CAPS.client_email),
    client_phone: clampLen(b.client_phone ?? null, FIELD_CAPS.client_phone),
    date: b.date,
    time_slot: b.time_slot,
    status,
    total_amount: grossTotal,
    deposit_paid: false,
    payment_method: b.pay_in_person ? "cash" : null,
    payment_status: b.pay_in_person ? "unpaid" : null,
    notes: clampLen(noteParts.length ? noteParts.join(" · ") : null, FIELD_CAPS.notes),
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

  // Stamp the tax portion best-effort (total_amount already includes it). Kept
  // separate so a prod without the tax_amount column can never fail the insert.
  if (inPersonTax > 0) {
    await supabaseAdmin.from("appointments")
      .update({ tax_amount: inPersonTax }).eq("id", inserted.data.id).then(null, () => null);
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

  // Gift card that covers this online-intent booking (routed here as a $0 Stripe
  // booking): store the GROSS (service + tax, like the online path), draw the
  // card down by the gross, and mark it PAID by gift card. payment_status is
  // plain text and total_amount always exists, so set those together (must
  // stick); tax_amount/paid_at and the CHECK-constrained payment_method go in
  // best-effort follow-ups (payment_method needs the phase37 migration).
  if (b.gift_code && effectiveTotal > 0) {
    const bs = (shop.booking_settings ?? {}) as TaxConfig;
    const taxAmt = taxCents(Math.round(effectiveTotal * 100), isPaidPlan(plan) ? combinedTaxRate(bs) : 0) / 100;
    const gross = Math.round((effectiveTotal + taxAmt) * 100) / 100;
    const applied = await redeemGift(b.shop_id, b.gift_code, gross);
    if (applied >= gross - 0.001) {
      await supabaseAdmin.from("appointments")
        .update({ total_amount: gross, payment_status: "paid" }).eq("id", inserted.data.id);
      await supabaseAdmin.from("appointments")
        .update({ tax_amount: taxAmt, paid_at: new Date().toISOString() }).eq("id", inserted.data.id).then(null, () => null);
      await supabaseAdmin.from("appointments")
        .update({ payment_method: "gift_card" }).eq("id", inserted.data.id).then(null, () => null);
    }
    // Record how much gift value was applied so revenue counts it once (at sale),
    // not again here. Best-effort (phase50 column) — safe to skip if it lags.
    if (applied > 0) {
      await supabaseAdmin.from("appointments")
        .update({ gift_applied: applied }).eq("id", inserted.data.id).then(null, () => null);
    }
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
    // Owner + barber "new booking" EMAILS — sent here (service role can look up
    // their real addresses) because the public page can't. Awaited so the
    // serverless invocation doesn't freeze before they go out.
    await sendNewBookingStaffEmails(inserted.data.id);
  }

  // Customer confirmation EMAIL — for BOTH portal (staff-added) and self-bookings
  // whenever there's an email on file. Email isn't plan-gated (Starter is
  // email-only), so this is the customer's confirmation regardless of plan/SMS.
  // Server-side (service role) so it works even from the anonymous booking page.
  await sendCustomerBookingEmail(inserted.data.id);

  // Text the customer their confirmation (server-side, best-effort). Sent for
  // BOTH customer self-bookings AND staff-added bookings — a barber booking a
  // client from inside the portal (e.g. taking a future appointment over the
  // phone) should confirm to that client by text exactly like the confirmation
  // EMAIL above already does. The only gates are: a phone on file + a plan with
  // SMS (Starter is email-only). Sent here, not from the public page, so
  // /api/twilio/send-sms can require auth (no open SMS relay).
  if (b.client_phone && isPaidPlan(plan)) {
    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
    const manageLink = `${origin}/my-booking/${inserted.data.id}`;
    const shopName = (shop as { name?: string }).name ?? "the shop";
    // Keep it short + GSM-7 only (no em dash, which forces UCS-2 and triples the
    // segment count). Shop name is added by sendSmsBestEffort's prefix; the manage
    // link carries the booking id, so no separate ref needed.
    // Cancellation policy (shop's notice window; default 2h). Appended to the
    // confirmed text so the customer knows the rule up front. GSM-7, kept short.
    const cancelHrs = Number((shop.booking_settings as { cancellation_hours?: number } | null)?.cancellation_hours ?? 2);
    const policy = cancelHrs > 0 ? ` Cancel/reschedule ${cancelHrs}h+ ahead.` : "";
    const smsBody = inserted.data.status === "pending"
      ? `Thanks! Your request for ${b.date} at ${b.time_slot} was received. We'll text you when it's confirmed. Manage: ${manageLink}`
      : `You're booked for ${b.date} at ${b.time_slot}.${policy} Manage: ${manageLink}`;
    await sendSmsBestEffort(b.client_phone, smsBody, shopName);
  }

  return NextResponse.json({
    id: inserted.data.id,
    status: inserted.data.status,
    barber_id: inserted.data.barber_id,
  });
}
