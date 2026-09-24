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

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from("transactions")
    .select("id, shop_id, payment_intent_id, refunded")
    .eq("payment_method", "card")
    .not("payment_intent_id", "is", null)
    .or("stripe_fee.is.null,stripe_fee.eq.0")
    .gte("created_at", cutoff)
    .lte("created_at", settled)
    .order("created_at", { ascending: false }).order("id")
    .limit(150);
  if (rowsError) throw new Error("Could not read transactions needing Stripe fees.");
  if (!rows || rows.length === 0) return { scanned: 0, filled: 0 };

  // Resolve each shop's connected-account id once (fee lives on the connected acct).
  const shopIds = Array.from(new Set(rows.map(r => r.shop_id).filter(Boolean))) as string[];
  const acctByShop = new Map<string, string | null>();
  if (shopIds.length) {
    const { data: shops, error: shopsError } = await supabaseAdmin
      .from("shops").select("id, stripe_account_id, stripe_connected").in("id", shopIds);
    if (shopsError) throw new Error("Could not resolve connected accounts for fee backfill.");
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
      const { data: saved, error: saveError } = await supabaseAdmin.from("transactions")
        .update({ stripe_fee: feeCents / 100 }).eq("id", r.id)
        .eq("shop_id", r.shop_id).eq("payment_intent_id", r.payment_intent_id)
        .or("stripe_fee.is.null,stripe_fee.eq.0")
        .select("id");
      if (saveError) throw new Error("Could not save a confirmed Stripe fee.");
      if (saved?.length === 1) filled++;
    }
  }
  return { scanned: rows.length, filled };
}
