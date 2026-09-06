import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripeFeeCents } from "@/lib/stripe";

/**
 * Fill in Stripe fees that weren't ready at charge time.
 *
 * The `balance_transaction` that carries the real processing fee is often NOT
 * available the instant we write the ledger row right after a capture, so
 * `stripe_fee` lands as 0 (a timing race, not a missing code path). The shop's
 * DISPLAYED net already nets fees live from Stripe (`byPi`), so those screens are
 * correct — but the STORED `stripe_fee` column feeds Payroll and CSV exports, so
 * we reconcile it here on the daily cron.
 *
 * Fee-only + best-effort: only fills a 0/null fee, NEVER overwrites a real one and
 * NEVER touches a money amount. Bounded so it can't run away on a big account.
 */
export async function backfillMissingStripeFees(): Promise<{ scanned: number; filled: number }> {
  // Look back ~45 days; skip the last 15 min so the balance-transaction has settled.
  const cutoff = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const settled = new Date(Date.now() - 15 * 60_000).toISOString();

  const { data: rows } = await supabaseAdmin
    .from("transactions")
    .select("id, shop_id, payment_intent_id, refunded")
    .eq("payment_method", "card")
    .not("payment_intent_id", "is", null)
    .or("stripe_fee.is.null,stripe_fee.eq.0")
    .gte("created_at", cutoff)
    .lte("created_at", settled)
    .limit(150);
  if (!rows || rows.length === 0) return { scanned: 0, filled: 0 };

  // Resolve each shop's connected-account id once (fee lives on the connected acct).
  const shopIds = Array.from(new Set(rows.map(r => r.shop_id).filter(Boolean))) as string[];
  const acctByShop = new Map<string, string | null>();
  if (shopIds.length) {
    const { data: shops } = await supabaseAdmin
      .from("shops").select("id, stripe_account_id, stripe_connected").in("id", shopIds);
    for (const s of shops ?? []) {
      acctByShop.set(s.id, (s.stripe_account_id && s.stripe_connected) ? s.stripe_account_id : null);
    }
  }

  let filled = 0;
  for (const r of rows) {
    if (r.refunded) continue;
    const acct = r.shop_id ? acctByShop.get(r.shop_id) ?? null : null;
    const feeCents = await stripeFeeCents(r.payment_intent_id as string, acct);
    if (feeCents > 0) {
      await supabaseAdmin.from("transactions")
        .update({ stripe_fee: feeCents / 100 }).eq("id", r.id).then(null, () => null);
      filled++;
    }
  }
  return { scanned: rows.length, filled };
}
