import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { barberHasConflict, findAvailableBarber } from "@/lib/booking-conflict";
import { timeToMinutes } from "@/lib/utils";

// Customer pays for a booking — charge runs on the shop's connected account (0% platform fee).
// The appointment is NOT created here; it's created on success via /booking-finalize.
export async function POST(request: NextRequest) {
  // Return URL from the live request origin so the redirect back from Stripe
  // works on any port/domain (NEXT_PUBLIC_APP_URL can be stale, e.g. :3001).
  const BASE_URL = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const booking = await request.json() as {
    shop_id: string;
    shop_slug: string;
    barber_id: string | null;
    service_id: string;
    service_name: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    date: string;
    time_slot: string;
    amount: number; // dollars to charge now (deposit or full)
    total_amount: number; // full appointment total
    hold?: boolean; // when true: authorize (manual capture) instead of charging
    saveCard?: boolean; // when true: save the card (no charge now), charge later on completion/no-show
  };

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id, stripe_connected, subscription_plan, subscription_status")
    .eq("id", booking.shop_id).single();

  if (!shop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });

  // Block double-booking BEFORE taking any money — otherwise a customer could
  // pay and then have /booking-finalize fail, leaving them charged with no
  // appointment. Duration-aware (covers overlap with a longer existing
  // appointment), and resolves an "Any Available" booking to a concrete free
  // barber so the DB unique index actually protects it.
  const { data: svc } = await supabaseAdmin
    .from("services").select("duration_minutes").eq("id", booking.service_id).maybeSingle();
  const startMin = timeToMinutes(booking.time_slot);
  const endMin = startMin + (svc?.duration_minutes ?? 30);
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

  // Require Stripe Connect to charge — no platform-charge fallback, so funds
  // always land in the shop's own account, never the platform's. Until the
  // owner finishes Connect the customer can only pay in person.
  if (!useConnect) {
    return NextResponse.json(
      { error: "This shop hasn't finished setting up online payments yet. Please choose pay in person." },
      { status: 409 },
    );
  }

  const acctOpts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

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
    total_amount: String(booking.total_amount),
    hold: booking.hold ? "1" : "",
    save: booking.saveCard ? "1" : "",
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
        // hold = authorize only (no-show protection); captured later on
        // completion / no-show. Otherwise charge immediately as before.
        ...(booking.hold ? { payment_intent_data: { capture_method: "manual" as const } } : {}),
        line_items: [{
          price_data: {
            currency: "cad",
            product_data: { name: booking.hold ? `${booking.service_name} — hold (charged after visit)` : `${booking.service_name} — deposit` },
            unit_amount: Math.round(booking.amount * 100),
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
