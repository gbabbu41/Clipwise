import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify";

// Called when the POS returns from a paid card checkout. Verifies the payment
// on the connected account, then records the transaction + decrements stock.
// Server-side idempotency: stripe_session_id unique index prevents double-insert.
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

    // Idempotency: return existing transaction if this session was already finalized
    const { data: existing } = await supabaseAdmin
      .from("transactions").select("id").eq("stripe_session_id", session_id).maybeSingle();
    if (existing) {
      return NextResponse.json({ paid: true, transactionId: existing.id, sale: { subtotal, tip, discount, total, tax: Number(m.tax ?? 0), method: "card", client_name: m.client_name || "Walk-in", service_name: m.service_name || "Sale" } });
    }

    const tax = Number(m.tax ?? 0);
    const fullRow: Record<string, unknown> = {
      shop_id,
      barber_id: m.barber_id || null,
      client_name: m.client_name || "Walk-in",
      service_name: m.service_name || "Sale",
      amount: subtotal,
      tip,
      tax,
      commission_amount: m.commission_amount ? Number(m.commission_amount) : null,
      payment_method: "card",
      type: m.type || "service",
      stripe_session_id: session_id,
      payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      source: "pos",
    };
    // Insert; progressively drop columns that don't exist yet (tax = phase30,
    // payment_intent_id = phase16) so a POS sale is never lost pre-migration.
    const attempt = (row: Record<string, unknown>) => supabaseAdmin.from("transactions").insert(row).select("id").single();
    let ins = await attempt(fullRow);
    for (let i = 0; i < 2 && ins.error && /column|does not exist|schema cache/i.test(ins.error.message); i++) {
      const trimmed = { ...fullRow };
      if (/tax/.test(ins.error.message)) delete trimmed.tax;
      if (/payment_intent_id/.test(ins.error.message)) delete trimmed.payment_intent_id;
      ins = await attempt(trimmed);
    }
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    const txRow = ins.data;

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
