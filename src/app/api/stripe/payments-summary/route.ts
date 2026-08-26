import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop } from "@/lib/api-auth";

const WEEKDAY: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// Estimate the next payout date from the account's payout schedule (used when
// Stripe hasn't created a pending payout object yet). Returns unix seconds.
function estimateNextPayout(sch?: { interval?: string; weekly_anchor?: string | null; monthly_anchor?: number | null; delay_days?: number | null }): number | null {
  if (!sch || sch.interval === "manual") return null;
  const now = new Date();
  const at = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
  if (sch.interval === "daily") {
    const d = new Date(now); d.setDate(d.getDate() + Math.max(1, sch.delay_days ?? 2)); return at(d);
  }
  if (sch.interval === "weekly") {
    const target = WEEKDAY[sch.weekly_anchor ?? "friday"] ?? 5;
    const d = new Date(now);
    let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add); return at(d);
  }
  if (sch.interval === "monthly") {
    const anchor = sch.monthly_anchor ?? 1;
    const d = new Date(now.getFullYear(), now.getMonth(), anchor);
    if (d.getTime() <= now.getTime()) d.setMonth(d.getMonth() + 1);
    return at(d);
  }
  return null;
}

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
  // Financials — owner or an active barber of the shop only. shop_id is
  // effectively public (the booking flow passes it around), so without this gate
  // anyone could read any shop's Stripe balance, payouts, and revenue.
  const auth = await authorizeShop(req, shop_id);
  if ("error" in auth) return auth.error;
  const isOwner = auth.isOwner;
  const shop = auth.shop as { stripe_account_id?: string | null; stripe_connected?: boolean | null };
  const connected = !!(shop?.stripe_account_id && shop.stripe_connected);
  if (!connected) {
    // The #1 reason fees + payout go blank: this shop isn't fully Stripe-
    // connected, so there's no balance/fee data to show. Log it so it's not a
    // silent mystery.
    console.log("[payments-summary] not connected", {
      shop_id, hasAccount: !!shop?.stripe_account_id, connectedFlag: !!shop?.stripe_connected,
    });
    return NextResponse.json({ connected: false, byPi: {}, available: 0, pending: 0 });
  }
  const opts = { stripeAccount: shop!.stripe_account_id! };

  try {
    const balance = await stripe.balance.retrieve({}, opts);
    const sum = (arr?: { amount: number }[]) => (arr ?? []).reduce((s, b) => s + b.amount, 0) / 100;
    const available = sum(balance.available);
    const pending = sum(balance.pending);

    // Next scheduled payout's arrival date + amount + the most recent completed payout.
    let nextPayoutDate: number | null = null;
    let nextPayoutAmount: number | null = null;
    let lastPayout: { amount: number; date: number } | null = null;
    // Money already sweeping to the bank (left the Stripe balance as payouts).
    let inTransit = 0;
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      const payouts = await stripe.payouts.list({ limit: 10 }, opts);
      // "On the way to your bank" = payouts not yet arrived. Sandbox marks payouts
      // paid immediately but keeps a FUTURE arrival date, so include those too —
      // otherwise this reads $0 even though Stripe clearly shows money on the way.
      const onTheWay = payouts.data.filter(p =>
        p.status === "pending" || p.status === "in_transit" ||
        (p.status === "paid" && p.arrival_date > nowSec),
      );
      inTransit = onTheWay.reduce((s, p) => s + p.amount, 0) / 100;
      // Next payout = the soonest-arriving of those.
      const upcoming = [...onTheWay].sort((a, b) => a.arrival_date - b.arrival_date)[0];
      nextPayoutDate = upcoming?.arrival_date ?? null;
      nextPayoutAmount = upcoming ? upcoming.amount / 100 : null;
      // Last payout = the most recent one that has ALREADY landed (arrival passed);
      // fall back to the most recent paid payout so it's never wrongly blank.
      const paid = payouts.data.find(p => p.status === "paid" && p.arrival_date <= nowSec)
        ?? payouts.data.find(p => p.status === "paid");
      if (paid) lastPayout = { amount: paid.amount / 100, date: paid.arrival_date <= nowSec ? paid.arrival_date : paid.created };
    } catch { /* schedule not available — leave null */ }

    // No pending payout object yet → estimate the next date from the schedule.
    if (!nextPayoutDate) {
      try {
        const acct = await stripe.accounts.retrieve(shop!.stripe_account_id!);
        nextPayoutDate = estimateNextPayout(acct.settings?.payouts?.schedule);
      } catch { /* ignore */ }
    }

    // Walk balance transactions; map the underlying charge's PaymentIntent ->
    // exact gross/fee/net. Only charge sources carry a payment_intent, so refunds
    // and payouts are naturally skipped.
    const byPi: Record<string, { gross: number; fee: number; net: number }> = {};
    let startingAfter: string | undefined;
    // Walk until Stripe says there are no more pages (was hard-capped at 6 pages /
    // ~600 balance txns, so an established shop's older charges had no fee data and
    // Net read too high). Bounded at 50 pages (~5,000 txns) to stay within the
    // serverless time budget.
    for (let page = 0; page < 50; page++) {
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

    console.log("[payments-summary] ok", {
      shop_id, byPi: Object.keys(byPi).length, available, pending, inTransit, nextPayoutDate, nextPayoutAmount,
    });
    // Shop-wide balance + payout schedule are OWNER-only. A barber gets just the
    // per-payment fee map (byPi) — enough to net fees on their own cuts, never the
    // shop's balance or payouts.
    return NextResponse.json(
      isOwner
        ? { connected: true, byPi, available, pending, inTransit, nextPayoutDate, nextPayoutAmount, lastPayout }
        : { connected: true, byPi },
    );
  } catch (err) {
    // A Stripe error here (e.g. the connected account id belongs to a different
    // Stripe mode than the current key, or a permissions issue) makes fees +
    // payout silently vanish — the page ignores `error` responses. Surface it to
    // the Vercel logs AND the CEO error panel so the real cause is visible.
    const msg = err instanceof Error ? err.message : "stripe error";
    console.error("[payments-summary] stripe error", { shop_id, msg });
    supabaseAdmin.from("error_logs").insert({
      level: "error", source: "payments-summary",
      message: `payments-summary Stripe error (shop ${shop_id ?? "?"}): ${msg}`.slice(0, 1000),
      path: "/api/stripe/payments-summary",
    }).then(null, () => null);
    return NextResponse.json({ connected: true, byPi: {}, available: 0, pending: 0, error: msg });
  }
}
