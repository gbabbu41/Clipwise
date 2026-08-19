import { NextRequest, NextResponse } from "next/server";
import { stripe, stripeFeeCents } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { fetchValidPromo, consumePromo } from "@/lib/promo";
import { redeemPointsForDiscount } from "@/lib/loyalty-redeem";
import { upsertClient } from "@/lib/clients-server";
import { sendPaymentReceipt } from "@/lib/payment-notify";
import { type TaxConfig } from "@/lib/pricing";

// Called when the POS returns from a paid card checkout. Verifies the payment
// on the connected account, then records the transaction + decrements stock.
// Server-side idempotency: stripe_session_id unique index prevents double-insert.
export async function POST(request: NextRequest) {
  const { session_id, shop_id } = await request.json() as { session_id: string; shop_id: string };
  if (!session_id || !shop_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id, name, email, stripe_account_id, stripe_connected, booking_settings").eq("id", shop_id).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  try {
    const session = await stripe.checkout.sessions.retrieve(
      session_id, undefined, useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined,
    );
    if (session.payment_status !== "paid") return NextResponse.json({ paid: false });

    const m = session.metadata ?? {};
    if (m.flow !== "pos_sale" || m.shop_id !== shop_id) {
      return NextResponse.json({ error: "Session mismatch" }, { status: 400 });
    }

    const subtotal = Number(m.subtotal ?? 0);
    const tip = Number(m.tip ?? 0);
    const discount = Number(m.discount ?? 0);
    const loyaltyDiscount = Math.max(0, Number(m.loyalty_discount ?? 0));
    // Charged total = what Stripe actually took (passed through unchanged).
    const total = m.total != null ? Number(m.total) : subtotal + tip - discount;

    // Idempotency: return existing transaction if this session was already finalized
    const { data: existing } = await supabaseAdmin
      .from("transactions").select("id").eq("stripe_session_id", session_id).maybeSingle();
    if (existing) {
      return NextResponse.json({ paid: true, transactionId: existing.id, sale: { subtotal, tip, discount, total, tax: Number(m.tax ?? 0), method: "card", client_name: m.client_name || "Walk-in", service_name: m.service_name || "Sale" } });
    }

    const tax = Number(m.tax ?? 0);
    const piId = typeof session.payment_intent === "string" ? session.payment_intent : null;
    // Real Stripe fee for this card sale (split 50/50 barber/shop at read time).
    // Best-effort → 0.
    const stripeFee = (await stripeFeeCents(piId, useConnect ? shop.stripe_account_id : null)) / 100;
    const fullRow: Record<string, unknown> = {
      shop_id,
      barber_id: m.barber_id || null,
      client_name: m.client_name || "Walk-in",
      client_email: m.client_email || null,
      service_name: m.service_name || "Sale",
      // Ledger the amount actually COLLECTED for the service (net of any POS
      // discount + loyalty redemption), not the pre-discount subtotal — otherwise
      // every discounted card sale overstates revenue in Payments/analytics.
      amount: Math.max(0, subtotal - discount - loyaltyDiscount),
      tip,
      tax,
      stripe_fee: stripeFee,
      commission_amount: m.commission_amount ? Number(m.commission_amount) : null,
      payment_method: "card",
      type: m.type || "service",
      stripe_session_id: session_id,
      payment_intent_id: piId,
      source: "pos",
    };
    // Insert; progressively drop columns that don't exist yet (tax = phase30,
    // payment_intent_id = phase16, stripe_fee = phase38) so a POS sale is never
    // lost pre-migration.
    const attempt = (row: Record<string, unknown>) => supabaseAdmin.from("transactions").insert(row).select("id").single();
    let ins = await attempt(fullRow);
    for (let i = 0; i < 3 && ins.error && /column|does not exist|schema cache/i.test(ins.error.message); i++) {
      const trimmed = { ...fullRow };
      if (/tax/.test(ins.error.message)) delete trimmed.tax;
      if (/stripe_fee/.test(ins.error.message)) delete trimmed.stripe_fee;
      if (/payment_intent_id/.test(ins.error.message)) delete trimmed.payment_intent_id;
      if (/client_email/.test(ins.error.message)) delete trimmed.client_email;
      ins = await attempt(trimmed);
    }
    if (ins.error) {
      console.error("[pos-finalize] transaction insert failed:", ins.error.message);
      return NextResponse.json({ error: "Couldn't record the sale. Please try again." }, { status: 500 });
    }
    const txRow = ins.data;

    // Consume the promo now that the sale is recorded — draws down uses_left +
    // records the redemption (once-per-customer). Only reached on a NEW insert
    // (a duplicate finalize returns at the idempotency check above), so a code is
    // never double-consumed. No appointment for a POS sale → appointment_id null.
    if (m.promo_code) {
      const promo = await fetchValidPromo(shop_id, m.promo_code);
      if (promo) await consumePromo(promo, shop_id, m.client_email || null, m.client_phone || null, null);
    }

    // Settle loyalty points for a redeemed discount (server converts $ → points,
    // capped at the client's real balance). Only on the NEW-insert path above, so
    // a duplicate finalize never double-deducts.
    if (m.redeem_loyalty === "1" && loyaltyDiscount > 0) {
      await redeemPointsForDiscount({
        shopId: shop_id, email: m.client_email || null, phone: m.client_phone || null,
        discountDollars: loyaltyDiscount, bookingSettings: shop.booking_settings,
      });
    }

    // Decrement inventory for any product items in the sale.
    let products: { id: string; qty: number }[] = [];
    try { products = JSON.parse(m.products || "[]"); } catch { products = []; }
    for (const p of products) {
      const { data: inv } = await supabaseAdmin
        .from("inventory").select("id, name, quantity, low_stock_threshold").eq("id", p.id).single();
      if (!inv) continue;
      const newQty = Math.max(0, inv.quantity - p.qty);
      await supabaseAdmin.from("inventory").update({ quantity: newQty }).eq("id", inv.id);
      if (newQty <= inv.low_stock_threshold && inv.quantity > inv.low_stock_threshold && shop.owner_id) {
        insertNotifications({
          user_id: shop.owner_id,
          shop_id,
          title: "Low Stock Alert",
          message: `${inv.name} is running low — only ${newQty} units remaining.`,
          type: "inventory",
        });
      }
    }

    // Save the customer into the shop's client book (server-side, deduped) so a
    // POS sale reliably lands them in Clients. Only reached on a NEW insert (a
    // duplicate finalize returns at the idempotency check above), so the customer
    // + receipt fire exactly once. Both awaited so they run before the function
    // returns; both never throw, so they can't fail the recorded sale.
    await upsertClient(shop_id, m.client_name, m.client_email, m.client_phone, total);

    // Email the customer their ClipWise receipt. (Stripe's own receipt is off in
    // sandbox/test mode and gated behind a dashboard toggle even live, so this is
    // the receipt they can actually rely on.)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    // Itemized cart lines ride in the checkout metadata (compact JSON) — parse for
    // the receipt; best-effort, a bad/absent blob just falls back to a lump sum.
    let receiptItems: { n: string; q: number; p: number }[] | null = null;
    try { const parsed = JSON.parse(m.items || "[]"); if (Array.isArray(parsed)) receiptItems = parsed; } catch { /* ignore */ }
    await sendPaymentReceipt(baseUrl, {
      clientEmail: m.client_email,
      clientName: m.client_name,
      shopName: shop.name,
      shopEmail: shop.email,
      serviceName: m.service_name,
      date: new Date().toISOString().slice(0, 10),
      amountCents: Math.round(total * 100),
      context: "Payment received",
      taxCents: Math.round(tax * 100),
      tipCents: Math.round(tip * 100),
      taxConfig: shop.booking_settings as TaxConfig | null,
      items: receiptItems,
      timezone: (shop as { timezone?: string | null }).timezone ?? null,
    });

    return NextResponse.json({
      paid: true,
      transactionId: txRow!.id,
      sale: {
        subtotal, tip, discount, total, tax, method: "card",
        client_name: m.client_name || "Walk-in",
        service_name: m.service_name || "Sale",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
