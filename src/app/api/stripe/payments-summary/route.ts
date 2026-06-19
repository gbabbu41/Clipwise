import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Cross-check Payments against Stripe (the source of truth for card money).
 * For the shop's connected account it returns:
 *   - byPi:  paymentIntent id -> { gross, fee, net } from balance transactions
 *            (the exact net after Stripe's fee), so each card row shows real net;
 *   - available + pending: the balance heading to the shop's bank (payout).
 *
 * Cash never touches Stripe, so it isn't here — the page keeps cash from the DB.
 * Un-onboarded shops can't take card at all, so `connected:false` and the page
 * just shows what little it has. No DB fee math is ever done.
 */
export async function POST(req: NextRequest) {
  const { shop_id } = (await req.json().catch(() => ({}))) as { shop_id?: string };
  if (!shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id, stripe_connected").eq("id", shop_id).maybeSingle();
  const connected = !!(shop?.stripe_account_id && shop.stripe_connected);
  if (!connected) {
    return NextResponse.json({ connected: false, byPi: {}, available: 0, pending: 0 });
  }
  const opts = { stripeAccount: shop!.stripe_account_id! };

  try {
    const balance = await stripe.balance.retrieve({}, opts);
    const sum = (arr?: { amount: number }[]) => (arr ?? []).reduce((s, b) => s + b.amount, 0) / 100;
    const available = sum(balance.available);
    const pending = sum(balance.pending);

    // Next scheduled payout's arrival date (the upcoming deposit to the bank).
    let nextPayoutDate: number | null = null;
    try {
      const payouts = await stripe.payouts.list({ limit: 5 }, opts);
      const upcoming = payouts.data.find(p => p.status === "pending" || p.status === "in_transit");
      nextPayoutDate = upcoming?.arrival_date ?? null;
    } catch { /* schedule not available — leave null */ }

    // Walk balance transactions; map the underlying charge's PaymentIntent ->
    // exact gross/fee/net. Only charge sources carry a payment_intent, so refunds
    // and payouts are naturally skipped.
    const byPi: Record<string, { gross: number; fee: number; net: number }> = {};
    let startingAfter: string | undefined;
    for (let page = 0; page < 6; page++) {
      const list = await stripe.balanceTransactions.list(
        { limit: 100, expand: ["data.source"], ...(startingAfter ? { starting_after: startingAfter } : {}) },
        opts,
      );
      for (const bt of list.data) {
        const src = bt.source as { payment_intent?: string | null } | null;
        const pi = src && typeof src === "object" ? src.payment_intent ?? null : null;
        if (pi) byPi[pi] = { gross: bt.amount / 100, fee: bt.fee / 100, net: bt.net / 100 };
      }
      if (!list.has_more) break;
      startingAfter = list.data[list.data.length - 1]?.id;
    }

    return NextResponse.json({ connected: true, byPi, available, pending, nextPayoutDate });
  } catch (err) {
    return NextResponse.json({ connected: true, byPi: {}, available: 0, pending: 0, error: err instanceof Error ? err.message : "stripe error" });
  }
}
