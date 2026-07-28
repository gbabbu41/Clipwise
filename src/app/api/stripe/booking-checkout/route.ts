import { NextRequest, NextResponse } from "next/server";
import { stripe, STRIPE_LIVE_MODE } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { barberHasConflict, findAvailableBarber } from "@/lib/booking-conflict";
import { scheduleBlockReason } from "@/lib/schedule-block";
import { timeToMinutes } from "@/lib/utils";
import { fetchValidPromo, promoDiscount, promoBlockReason } from "@/lib/promo";
import { taxCents, combinedTaxRate, type TaxConfig } from "@/lib/pricing";
import { resolveServiceCharge } from "@/lib/service-pricing";
import { enforceRateLimit } from "@/lib/rate-limit";

// Customer pays for a booking — charge runs on the shop's connected account (0% platform fee).
// The appointment is NOT created here; it's created on success via /booking-finalize.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "booking-checkout", 12, 60_000);
  if (limited) return limited;

  // Return URL from the live request origin so the redirect back from Stripe
  // works on any port/domain (NEXT_PUBLIC_APP_URL can be stale, e.g. :3001).
  const BASE_URL = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const booking = await request.json() as {
    shop_id: string;
    shop_slug: string;
    barber_id: string | null;
    service_id: string;
    service_ids?: string[]; // full multiset — server recomputes the real price from these
    service_name: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    date: string;
    time_slot: string;
    amount: number; // dollars to charge now (deposit or full)
    total_amount: number; // full appointment total
    duration_minutes?: number; // combined length for multi-service bookings
    service_names?: string;    // "Haircut + Beard" when multiple services were picked
    hold?: boolean; // when true: authorize (manual capture) instead of charging
    saveCard?: boolean; // when true: save the card (no charge now), charge later on completion/no-show
    subtotal?: number;  // pre-discount total, for server-side promo math
    promo_code?: string; // validated + recomputed server-side (never trust the client discount)
    tip_amount?: number; // customer-chosen tip in dollars (immediate full payment only)
  };

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id, stripe_connected, subscription_plan, subscription_status, booking_settings")
    .eq("id", booking.shop_id).single();

  if (!shop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });

  // Emergency pause — owner flipped the kill switch; stop taking bookings.
  if ((shop.booking_settings as { bookings_paused?: boolean } | null)?.bookings_paused) {
    return NextResponse.json({ error: "This shop isn't accepting bookings right now." }, { status: 403 });
  }

  // Block double-booking BEFORE taking any money — otherwise a customer could
  // pay and then have /booking-finalize fail, leaving them charged with no
  // appointment. Duration-aware (covers overlap with a longer existing
  // appointment), and resolves an "Any Available" booking to a concrete free
  // barber so the DB unique index actually protects it.
  // ── Server-authoritative price + duration (NEVER trust the client) ──────────
  // Sum the REAL prices/durations from the DB for the selected services (a
  // multiset — the same service can repeat), scoped to this shop so a client
  // can't POST a fake total_amount or reference another shop's cheaper service.
  const requestedServiceIds = (Array.isArray(booking.service_ids) && booking.service_ids.length)
    ? booking.service_ids
    : [booking.service_id];
  const charge = await resolveServiceCharge(booking.shop_id, requestedServiceIds);
  if (!charge.allResolved || charge.count === 0) {
    return NextResponse.json({ error: "One or more selected services are unavailable." }, { status: 400 });
  }
  const startMin = timeToMinutes(booking.time_slot);
  const bookingDuration = charge.duration > 0 ? charge.duration : 30;
  const endMin = startMin + bookingDuration;
  let resolvedBarberId = booking.barber_id || null;
  if (resolvedBarberId) {
    if (await barberHasConflict(resolvedBarberId, booking.date, startMin, endMin)) {
      return NextResponse.json(
        { error: "Sorry, that time was just booked. Please pick another slot." },
        { status: 409 },
      );
    }
  } else {
    resolvedBarberId = await findAvailableBarber(booking.shop_id, booking.date, startMin, endMin);
    if (!resolvedBarberId) {
      return NextResponse.json(
        { error: "Sorry, that time is fully booked. Please pick another slot." },
        { status: 409 },
      );
    }
  }

  // Don't let a customer PAY for a slot that's blocked by the barber's schedule
  // (approved time-off / recurring break) — the in-person path already enforces
  // this; the online path never did (the client only *renders* valid slots, and
  // a slot can be blocked after page load or the POST replayed). Checked BEFORE
  // taking any money so the customer is never charged for an unbookable time.
  const blockReason = await scheduleBlockReason(
    booking.shop_id, resolvedBarberId, booking.date, startMin, endMin, { includeBreaks: true },
  );
  if (blockReason) return NextResponse.json({ error: blockReason }, { status: 409 });

  // Online payments are a paid feature (per the admin-editable plans table)
  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "payments")) {
    return NextResponse.json({ error: "Online payments require a paid plan." }, { status: 403 });
  }

  // Connect direct-charge when the shop has finished onboarding. Otherwise
  // fall back to a platform charge so demo / test-mode flows work without
  // the shop owner needing to complete Connect KYC.
  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  // In live mode require Connect — funds must land in the shop's own account.
  // In test/sandbox allow a platform-charge fallback so demos work without KYC.
  if (!useConnect && STRIPE_LIVE_MODE) {
    return NextResponse.json(
      { error: "This shop hasn't finished setting up online payments yet. Please choose pay in person." },
      { status: 409 },
    );
  }

  const acctOpts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

  // ── Promo (server-authoritative) — never trust the client's discounted amount.
  // Validate the code + enforce cap/once-per-customer BEFORE charging, and
  // recompute the total from the subtotal. The code is consumed in /booking-
  // finalize once the appointment exists.
  // Server subtotal is authoritative; the client's subtotal/total_amount is ignored.
  let effectiveTotal = charge.subtotal;
  let promoCodeForMeta = "";
  if (booking.promo_code) {
    const promo = await fetchValidPromo(booking.shop_id, booking.promo_code);
    if (!promo) return NextResponse.json({ error: "Invalid or expired promo code." }, { status: 400 });
    const blocked = await promoBlockReason(promo, booking.client_email, booking.client_phone);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
    effectiveTotal = Math.max(0, charge.subtotal - promoDiscount(promo, charge.subtotal));
    promoCodeForMeta = promo.code;
  }

  // ── Sales tax + tip (server-authoritative — never trust client amounts) ────
  // Tax config lives in the shop's booking_settings. Tax applies to the service
  // amount after discount; tip (immediate full payment only) is added after and
  // is never taxed. The stored appointment total = service + tax (excl. tip).
  const bs = (shop.booking_settings ?? {}) as Record<string, unknown>;
  // Only charge tax when registered (valid GST/HST number on file). The rate is
  // GST/HST + any optional PST/QST the owner turned on.
  const taxRatePct = combinedTaxRate(bs as TaxConfig);
  const tipsEnabled = bs.tips_enabled !== false;

  const serviceNetCents = Math.round(effectiveTotal * 100);      // discounted service total, pre-tax
  const taxAmtCents = taxCents(serviceNetCents, taxRatePct);
  const appointmentTotalCents = serviceNetCents + taxAmtCents;   // stored total (excl. tip)

  // Tip applies to any online path now: a HOLD authorizes service+tax+tip (so it
  // captures on completion), a SAVED card stores the tip and charges it at
  // completion, an immediate charge takes it now. Stored in metadata →
  // booking-finalize writes appointments.tip_amount → capture-appointment uses it.
  let tipAmtCents = 0;
  if (tipsEnabled) {
    tipAmtCents = Math.max(0, Math.round(Number(booking.tip_amount ?? 0) * 100));
    tipAmtCents = Math.min(tipAmtCents, serviceNetCents);        // cap at 100% of service (typo/abuse guard)
  }
  // Save-card charges nothing now; hold authorizes service+tax+tip; immediate charges service+tax+tip.
  const chargeNowCents = booking.saveCard ? 0 : appointmentTotalCents + tipAmtCents;

  // Shared booking details — written to the Checkout session metadata so
  // /booking-finalize can create the appointment on return.
  const metadata = {
    shop_id: booking.shop_id,
    barber_id: resolvedBarberId ?? "",
    service_id: booking.service_id,
    client_name: booking.client_name,
    client_email: booking.client_email,
    client_phone: booking.client_phone,
    date: booking.date,
    time_slot: booking.time_slot,
    total_amount: String(appointmentTotalCents / 100),
    tip_amount: String(tipAmtCents / 100),
    tax_amount: String(taxAmtCents / 100),
    duration_minutes: String(bookingDuration),
    service_names: booking.service_names ?? "",
    hold: booking.hold ? "1" : "",
    save: booking.saveCard ? "1" : "",
    promo_code: promoCodeForMeta,
  };

  try {
    // ── Save-card path (booking >7 days out) ────────────────────────────────
    // Card holds expire ~7 days, so we can't authorize this far ahead. Instead
    // collect + store the card now (no charge) via Checkout `setup` mode and
    // charge it off-session on completion / no-show. Setup mode requires an
    // explicit Customer, created on the connected account.
    if (booking.saveCard) {
      const customer = await stripe.customers.create(
        { email: booking.client_email || undefined, name: booking.client_name || undefined },
        acctOpts,
      );
      const session = await stripe.checkout.sessions.create(
        {
          mode: "setup",
          customer: customer.id,
          payment_method_types: ["card"],
          metadata,
          setup_intent_data: { metadata },
          success_url: `${BASE_URL}/book/${booking.shop_slug}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${BASE_URL}/book/${booking.shop_slug}?cancelled=1`,
        },
        acctOpts,
      );
      return NextResponse.json({ url: session.url });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // Pre-fill the Stripe Checkout email from what the customer already typed
        // at booking, so they don't re-enter it on the payment page.
        customer_email: booking.client_email || undefined,
        // hold = authorize only (no-show protection); captured later on
        // completion / no-show. Otherwise charge immediately as before.
        ...(booking.hold ? { payment_intent_data: { capture_method: "manual" as const } } : {}),
        line_items: [{
          price_data: {
            currency: "cad",
            product_data: {
              name: booking.hold
                ? `${booking.service_name} — hold (charged after visit)`
                : (tipAmtCents > 0 || taxAmtCents > 0)
                  ? `${booking.service_name} (incl. tax${tipAmtCents > 0 ? " + tip" : ""})`
                  : booking.service_name,
            },
            unit_amount: chargeNowCents,
          },
          quantity: 1,
        }],
        metadata,
        success_url: `${BASE_URL}/book/${booking.shop_slug}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/book/${booking.shop_slug}?cancelled=1`,
      },
      acctOpts,
    );

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
