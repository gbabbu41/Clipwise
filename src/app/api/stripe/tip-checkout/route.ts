import { NextRequest, NextResponse } from "next/server";
import { stripe, STRIPE_LIVE_MODE } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";

// Post-visit tip: a customer opens their tip link and leaves a tip. The charge
// runs on the shop's connected account (0% platform fee) and is recorded via the
// webhook (flow=tip). No appointment state changes — it's purely additive.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  const { appointment_id, tip_amount } = await request.json() as { appointment_id?: string; tip_amount?: number };
  if (!appointment_id) return NextResponse.json({ error: "Missing booking." }, { status: 400 });

  const tipCents = Math.round(Number(tip_amount ?? 0) * 100);
  if (!Number.isFinite(tipCents) || tipCents < 100) return NextResponse.json({ error: "Enter a tip of at least $1." }, { status: 400 });
  if (tipCents > 100000) return NextResponse.json({ error: "That tip seems too large." }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, shops(name, slug, stripe_account_id, stripe_connected, subscription_plan, subscription_status, booking_settings)")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  const shop = (Array.isArray(appt.shops) ? appt.shops[0] : appt.shops) as {
    name: string; slug: string; stripe_account_id: string | null; stripe_connected: boolean | null;
    subscription_plan: string; subscription_status: string | null; booking_settings: Record<string, unknown> | null;
  } | null;
  if (!shop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });

  if ((shop.booking_settings ?? {}).tips_enabled === false) {
    return NextResponse.json({ error: "This shop isn't accepting tips." }, { status: 403 });
  }

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status ?? undefined);
  if (!planHasFeature(plan, "payments")) return NextResponse.json({ error: "This shop can't accept online tips." }, { status: 403 });

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  if (!useConnect && STRIPE_LIVE_MODE) {
    return NextResponse.json({ error: "This shop hasn't finished payment setup yet." }, { status: 409 });
  }
  const acctOpts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "cad",
            product_data: { name: `Tip for ${shop.name}` },
            unit_amount: tipCents,
          },
          quantity: 1,
        }],
        metadata: {
          flow: "tip",
          appointment_id: appt.id,
          shop_id: appt.shop_id,
          barber_id: appt.barber_id ?? "",
          client_name: appt.client_name ?? "",
          tip_amount: String(tipCents / 100),
        },
        success_url: `${origin}/tip/${appt.id}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/tip/${appt.id}?cancelled=1`,
      },
      acctOpts,
    );
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
