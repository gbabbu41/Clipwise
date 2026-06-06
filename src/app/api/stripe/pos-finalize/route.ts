import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Called when the POS returns from a paid card checkout. Verifies the payment
// on the connected account, then records the transaction + decrements stock.
// transactions has no payment_intent column, so the caller guards against
// double-submit (runs once per mount, then strips ?session_id from the URL).
export async function POST(request: NextRequest) {
  const { session_id, shop_id } = await request.json() as { session_id: string; shop_id: string };
  if (!session_id || !shop_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id, stripe_account_id, stripe_connected").eq("id", shop_id).single();
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
    // Charged total = what Stripe actually took (passed through unchanged).
    const total = m.total != null ? Number(m.total) : subtotal + tip - discount;

    const { data: tx, error } = await supabaseAdmin.from("transactions").insert({
      shop_id,
      barber_id: m.barber_id || null,
      client_name: m.client_name || "Walk-in",
      service_name: m.service_name || "Sale",
      amount: subtotal,
      tip,
      commission_amount: m.commission_amount ? Number(m.commission_amount) : null,
      payment_method: "card",
      type: m.type || "service",
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
        supabaseAdmin.from("notifications").insert({
          user_id: shop.owner_id,
          title: "Low Stock Alert",
          message: `${inv.name} is running low — only ${newQty} units remaining.`,
          type: "inventory", is_read: false,
        }).then(null, () => null);
      }
    }

    return NextResponse.json({
      paid: true,
      transactionId: tx.id,
      sale: {
        subtotal, tip, discount, total, method: "card",
        client_name: m.client_name || "Walk-in",
        service_name: m.service_name || "Sale",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
