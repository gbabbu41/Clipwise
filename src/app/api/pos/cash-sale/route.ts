import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { fetchValidPromo, promoBlockReason, consumePromo, type PromoRow } from "@/lib/promo";
import { redeemPointsForDiscount } from "@/lib/loyalty-redeem";
import { upsertClient } from "@/lib/clients-server";
import { sendPaymentReceipt } from "@/lib/payment-notify";
import { type TaxConfig } from "@/lib/pricing";

/**
 * Record a cash (or gift-card-covered) POS sale server-side.
 *
 * Card/online sales go through Stripe → /api/stripe/pos-finalize, which inserts
 * the transaction with the SERVICE ROLE. Cash used to insert client-side with
 * the browser client, which RLS blocks (transactions has no owner INSERT
 * policy — every real write is service-role) — so cash sales errored where card
 * worked. This route mirrors pos-finalize: insert with supabaseAdmin, drop
 * columns prod may not have yet, then draw down inventory + gift card.
 */
export async function POST(req: Request) {
  try {
    // Auth — only the shop owner or an active barber of the shop may record a
    // sale. This route inserts with the SERVICE ROLE (bypassing RLS), so without
    // this gate anyone could POST fake revenue into any shop.
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const b = await req.json();
    const shop_id = b.shop_id as string | undefined;
    if (!shop_id) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

    const { data: shop } = await supabaseAdmin.from("shops").select("owner_id, name, email, booking_settings").eq("id", shop_id).maybeSingle();
    if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    let allowed = shop.owner_id === user.id;
    if (!allowed) {
      const { data: barber } = await supabaseAdmin
        .from("barbers").select("id").eq("shop_id", shop_id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
      allowed = !!barber;
    }
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Promo enforcement (server-authoritative) — validate the applied code's cap +
    // expiry + once-per-customer here (the POS only checks it in the browser).
    // Consumed after the sale row is recorded so usage draws down. Validated
    // BEFORE the insert so an invalid code is refused, not silently recorded.
    let validPromo: PromoRow | null = null;
    if (b.promo_code) {
      validPromo = await fetchValidPromo(shop_id, String(b.promo_code));
      if (!validPromo) return NextResponse.json({ error: "That promo code is invalid or expired." }, { status: 400 });
      const blocked = await promoBlockReason(validPromo, b.client_email, b.client_phone);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
    }

    const fullRow: Record<string, unknown> = {
      shop_id,
      barber_id: b.barber_id || null,
      client_name: b.client_name || "Walk-in",
      client_email: b.client_email || null,
      service_name: b.service_name || "Sale",
      amount: Number(b.amount) || 0,
      tip: Number(b.tip) || 0,
      tax: Number(b.tax) || 0,
      commission_amount: b.commission_amount != null ? Number(b.commission_amount) : null,
      payment_method: b.payment_method || "cash",
      type: b.type || "service",
      source: "pos",
    };

    // Insert; on a "column does not exist" error, accumulate-drop the optional
    // columns prod may lag on (tax = phase30, commission_amount, source) so a
    // sale is never lost pre-migration. Essential columns are never dropped.
    const dropped: string[] = [];
    const build = () => {
      const r = { ...fullRow };
      dropped.forEach(c => { delete r[c]; });
      return r;
    };
    const attempt = () => supabaseAdmin.from("transactions").insert(build()).select("id").single();
    let ins = await attempt();
    for (let i = 0; i < 4 && ins.error && /column|does not exist|schema cache/i.test(ins.error.message); i++) {
      let added = false;
      for (const col of ["tax", "commission_amount", "source", "client_email"]) {
        if (!dropped.includes(col) && new RegExp(`\\b${col}\\b`).test(ins.error.message)) { dropped.push(col); added = true; }
      }
      if (!added) break;
      ins = await attempt();
    }
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

    // Consume the promo now that the sale is recorded (draws down uses_left +
    // records the redemption for once-per-customer). Best-effort; no appointment
    // for a POS sale → appointment_id null.
    if (validPromo) {
      await consumePromo(validPromo, shop_id, b.client_email || null, b.client_phone || null, null);
    }

    // Settle loyalty points for a redeemed POS discount (server converts $ → points
    // and deducts, capped at the client's real balance). Best-effort.
    if (b.redeem_loyalty && Number(b.loyalty_discount) > 0) {
      await redeemPointsForDiscount({
        shopId: shop_id, email: b.client_email || null, phone: b.client_phone || null,
        discountDollars: Number(b.loyalty_discount), bookingSettings: shop.booking_settings,
      });
    }

    // Draw down inventory for product line items + low-stock alert.
    const products = Array.isArray(b.products) ? (b.products as { id: string; qty: number }[]) : [];
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

    // Redeem the gift card for the covered amount (its value was already booked
    // as revenue when sold, so the sale only records the non-gift remainder).
    const gc = b.gift_card as { id: string; applied: number } | null;
    if (gc?.id && Number(gc.applied) > 0) {
      // Re-read the real balance from the DB — never trust the client's
      // remaining_value — and clamp the redemption to it.
      const { data: card } = await supabaseAdmin
        .from("gift_cards").select("remaining_value").eq("id", gc.id).maybeSingle();
      if (card) {
        const bal = Number(card.remaining_value) || 0;
        const applied = Math.min(Number(gc.applied) || 0, bal);
        const newBal = Math.max(0, bal - applied);
        await supabaseAdmin.from("gift_cards").update({
          remaining_value: newBal, is_active: newBal > 0, redeemed_at: new Date().toISOString(),
        }).eq("id", gc.id).then(null, () => null);
      }
    }

    // Save the customer into the shop's client book (server-side, deduped) so a
    // POS sale reliably lands them in Clients — the browser-side add can silently
    // fail and a barber has no client-side INSERT rights. Both this and the receipt
    // are awaited so they actually run before the serverless function returns; both
    // never throw, so they can't fail the recorded sale.
    await upsertClient(shop_id, b.client_name, b.client_email, b.client_phone,
      (Number(b.amount) || 0) + (Number(b.tax) || 0) + (Number(b.tip) || 0));

    // Email the customer their receipt — the same ClipWise receipt appointments
    // send (cash gets no Stripe receipt, so this is the only one they'll get).
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const amt = Number(b.amount) || 0, tax = Number(b.tax) || 0, tip = Number(b.tip) || 0;
    await sendPaymentReceipt(baseUrl, {
      clientEmail: b.client_email,
      clientName: b.client_name,
      shopName: shop.name,
      shopEmail: shop.email,
      serviceName: b.service_name,
      date: new Date().toISOString().slice(0, 10),
      amountCents: Math.round((amt + tax + tip) * 100),
      context: "Payment received",
      taxCents: Math.round(tax * 100),
      tipCents: Math.round(tip * 100),
      taxConfig: shop.booking_settings as TaxConfig | null,
      items: (b as { items?: { n: string; q: number; p: number }[] }).items ?? null,
      timezone: (shop as { timezone?: string | null }).timezone ?? null,
    });

    return NextResponse.json({ transactionId: ins.data!.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Cash sale error" }, { status: 500 });
  }
}
