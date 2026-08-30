import { NextRequest, NextResponse } from "next/server";
import { stripe, stripeFeeCents } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop } from "@/lib/api-auth";
import { insertNotifications } from "@/lib/notify-server";
import { posCommissionFor } from "@/lib/commission-server";

/**
 * Capture a card-present PaymentIntent (after the reader collected the card) and
 * record the sale as a normal POS transaction — the SAME `transactions` row a
 * card POS sale writes, so tap sales appear in Payments/receipts with zero feed
 * changes.
 *
 * Mirrors pos-finalize but keyed on the card-present PaymentIntent instead of a
 * Checkout session. The sale details come from the PI metadata that
 * /terminal/create-intent stamped server-side — never from the client — so a
 * caller can't record a different amount than what the reader charged.
 *
 * Auth: shop owner OR an active barber. Idempotent on payment_intent_id.
 */
export async function POST(req: NextRequest) {
  const { shop_id, payment_intent_id } = (await req.json().catch(() => ({}))) as {
    shop_id?: string; payment_intent_id?: string;
  };
  if (!payment_intent_id) return NextResponse.json({ error: "Missing payment_intent_id" }, { status: 400 });

  const auth = await authorizeShop(req, shop_id);
  if ("error" in auth) return auth.error;
  const shop = auth.shop as {
    id: string; owner_id: string | null; stripe_account_id?: string | null; stripe_connected?: boolean;
  };
  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  const acct = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

  try {
    // Idempotency: if we already recorded this PI, return the existing row.
    const { data: existing } = await supabaseAdmin
      .from("transactions").select("id").eq("payment_intent_id", payment_intent_id).maybeSingle();
    if (existing) return NextResponse.json({ recorded: true, transactionId: existing.id });

    let pi = await stripe.paymentIntents.retrieve(payment_intent_id, undefined, acct);
    const m = pi.metadata ?? {};
    // Only ever touch a PI our own create-intent stamped for THIS shop.
    if (m.flow !== "pos_terminal_sale" || m.shop_id !== shop.id) {
      return NextResponse.json({ error: "Payment mismatch" }, { status: 400 });
    }

    // Capture once the reader has processed it; tolerate an already-captured PI.
    if (pi.status === "requires_capture") {
      pi = await stripe.paymentIntents.capture(payment_intent_id, {}, acct);
    }
    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: `Payment isn't complete (${pi.status}).`, status: pi.status }, { status: 409 });
    }

    const subtotal = Number(m.subtotal ?? 0);
    const discount = Number(m.discount ?? 0);
    const tip = Number(m.tip ?? 0);
    const tax = Number(m.tax ?? 0);
    // Real Stripe fee for this sale (read from the connected account's balance
    // transaction; split 50/50 barber/shop at read time elsewhere). Best-effort → 0.
    const stripeFee = (await stripeFeeCents(payment_intent_id, useConnect ? shop.stripe_account_id : null)) / 100;

    const fullRow: Record<string, unknown> = {
      shop_id: shop.id,
      barber_id: m.barber_id || null,
      client_name: m.client_name || "Walk-in",
      service_name: m.service_name || "Sale",
      // Ledger the amount collected for the service (net of any POS discount),
      // matching pos-finalize so discounted card sales don't overstate revenue.
      amount: Math.max(0, subtotal - discount),
      tip,
      tax,
      stripe_fee: stripeFee,
      // Commission from the barber's DB rate (never the browser). Base = service
      // subtotal after discount from metadata; fall back to the collected amount.
      commission_amount: await posCommissionFor(
        m.barber_id || null,
        m.commission_base != null && m.commission_base !== "" ? Number(m.commission_base) : Math.max(0, subtotal - discount),
      ),
      payment_method: "card",
      type: m.type || "service",
      payment_intent_id,
      source: "pos",
    };

    // Insert; progressively drop columns prod may lag on (tax = phase30,
    // stripe_fee = phase38, source) so a sale is never lost pre-migration.
    const attempt = (row: Record<string, unknown>) => supabaseAdmin.from("transactions").insert(row).select("id").single();
    let ins = await attempt(fullRow);
    for (let i = 0; i < 4 && ins.error && /column|does not exist|schema cache/i.test(ins.error.message); i++) {
      const trimmed = { ...fullRow };
      if (/tax/.test(ins.error.message)) delete trimmed.tax;
      if (/stripe_fee/.test(ins.error.message)) delete trimmed.stripe_fee;
      if (/payment_intent_id/.test(ins.error.message)) delete trimmed.payment_intent_id;
      if (/source/.test(ins.error.message)) delete trimmed.source;
      ins = await attempt(trimmed);
    }
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

    // Decrement inventory for any product line items in the sale.
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
          user_id: shop.owner_id, shop_id: shop.id, type: "inventory",
          title: "Low Stock Alert",
          message: `${inv.name} is running low — only ${newQty} units remaining.`,
        });
      }
    }

    return NextResponse.json({ recorded: true, transactionId: ins.data!.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Terminal error" }, { status: 500 });
  }
}
