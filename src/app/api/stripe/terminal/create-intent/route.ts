import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { authorizeShop } from "@/lib/api-auth";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { effectivePlan, planHasFeature } from "@/lib/validation";

/**
 * Create a card-present PaymentIntent on the shop's connected account for a POS
 * tap sale (WisePad 3 or Tap to Pay).
 *
 * Flow: this creates the intent (manual capture) → the native Terminal SDK
 * collects the card on the reader → /terminal/capture finalizes AND records the
 * sale. The sale details are stamped into the PI metadata here (server-set), so
 * /capture records the transaction from metadata and never trusts client input.
 *
 * Amount is the staff-entered POS total — the SAME trust model as pos-checkout:
 * the caller is authenticated shop staff at the counter, not a customer.
 *
 * Auth: shop owner OR an active barber. Requires payments plan + Connect.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    shop_id?: string;
    barber_id?: string | null;
    client_name?: string;
    client_email?: string | null;
    service_name?: string;
    subtotal?: number; tip?: number; discount?: number; total?: number; tax?: number;
    commission_amount?: number | null;
    type?: string;
    products?: { id: string; qty: number }[];
  };

  const auth = await authorizeShop(req, body.shop_id);
  if ("error" in auth) return auth.error;
  const shop = auth.shop as {
    id: string; stripe_account_id?: string | null; stripe_connected?: boolean;
    subscription_plan?: string | null; subscription_status?: string | null;
  };

  await ensurePlansHydrated();
  if (!planHasFeature(effectivePlan(shop.subscription_plan ?? undefined, shop.subscription_status ?? undefined), "payments")) {
    return NextResponse.json({ error: "Card payments aren't included on this plan." }, { status: 403 });
  }
  if (!shop.stripe_account_id || !shop.stripe_connected) {
    return NextResponse.json({ error: "Finish Stripe setup before using a card reader." }, { status: 400 });
  }

  const subtotal = Math.max(0, Number(body.subtotal) || 0);
  const tip = Math.max(0, Number(body.tip) || 0);
  const discount = Math.max(0, Number(body.discount) || 0);
  const tax = Math.max(0, Number(body.tax) || 0);
  const total = body.total != null ? Number(body.total) : subtotal - discount + tip + tax;
  const cents = Math.round(total * 100);
  if (!(cents > 0)) return NextResponse.json({ error: "Amount must be greater than zero." }, { status: 400 });

  try {
    const pi = await stripe.paymentIntents.create({
      amount: cents,
      currency: "cad",
      payment_method_types: ["card_present"],
      capture_method: "manual",
      // No application_fee_amount → 0% platform fee (shop is merchant of record),
      // matching every other ClipWise payment path.
      metadata: {
        flow: "pos_terminal_sale",
        shop_id: shop.id,
        barber_id: body.barber_id || "",
        client_name: body.client_name || "Walk-in",
        service_name: body.service_name || "Sale",
        subtotal: String(subtotal),
        tip: String(tip),
        discount: String(discount),
        tax: String(tax),
        total: String(total),
        commission_amount: body.commission_amount != null ? String(body.commission_amount) : "",
        type: body.type || "service",
        products: JSON.stringify(Array.isArray(body.products) ? body.products : []),
      },
      ...(body.client_email ? { receipt_email: body.client_email } : {}),
    }, { stripeAccount: shop.stripe_account_id });

    return NextResponse.json({ payment_intent_id: pi.id, client_secret: pi.client_secret });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Terminal error" }, { status: 500 });
  }
}
