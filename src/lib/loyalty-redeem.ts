import { supabaseAdmin } from "@/lib/supabase-admin";
import { planHasFeature } from "@/lib/validation";

// Shared, SERVER-AUTHORITATIVE loyalty redemption used by both customer booking
// paths (online checkout + in-person/free). The browser only ever sends a
// boolean "use my points" intent — never an amount. This file owns the math and
// the point deduction so a customer can't forge a bigger discount.

// A customer must have at least this much VALUE in points before they can redeem
// (owner-requested rule — stops trivial 1-point redemptions).
export const MIN_REDEEM_DOLLARS = 5;

type LoyaltyCfg = { enabled?: boolean; redemption_rate?: number } | null | undefined;

/** `%` and `_` are LIKE wildcards — escape them so an email only ever matches itself. */
export const exactIlike = (v: string): string => v.replace(/[\\%_]/g, c => `\\${c}`);

/**
 * A points change that could not be saved. Logged to error_logs (ids only) so a
 * balance never changes — or fails to — without a trace. Never throws.
 */
export async function logLoyaltyFailure(where: string, ids: { shopId?: string | null; clientId?: string | null; appointmentId?: string | null }, error: unknown): Promise<void> {
  const reason = (error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "unknown error")).slice(0, 200);
  const message = `Loyalty points change failed (${where}): client ${ids.clientId ?? "n/a"}, appointment ${ids.appointmentId ?? "n/a"} — ${reason}`;
  console.error("[loyalty]", message);
  try {
    await supabaseAdmin.from("error_logs").insert({ level: "error", source: "loyalty", message, path: where, shop_id: ids.shopId ?? null });
  } catch { /* best-effort */ }
}

function loyaltyCfg(bookingSettings: unknown): LoyaltyCfg {
  return (bookingSettings as { loyalty?: LoyaltyCfg } | null)?.loyalty ?? null;
}

/** The client (by email → phone) and their current points balance for a shop. */
async function findBalance(shopId: string, email?: string | null, phone?: string | null): Promise<{ id: string; points: number } | null> {
  const e = (email ?? "").trim();
  const p = (phone ?? "").trim();
  if (e) {
    const { data } = await supabaseAdmin.from("clients").select("id, loyalty_points").eq("shop_id", shopId).ilike("email", exactIlike(e)).maybeSingle();
    if (data) return { id: data.id, points: Math.max(0, Number(data.loyalty_points ?? 0)) };
  }
  if (p) {
    const { data } = await supabaseAdmin.from("clients").select("id, loyalty_points").eq("shop_id", shopId).eq("phone", p).maybeSingle();
    if (data) return { id: data.id, points: Math.max(0, Number(data.loyalty_points ?? 0)) };
  }
  return null;
}

/** Dollar value of a points balance under a shop's redemption rate (100 pts = $rate). */
export function pointsValue(points: number, redemptionRate: number): number {
  return Math.round((Math.max(0, points) / 100) * redemptionRate * 100) / 100;
}

/**
 * What a returning customer MAY see/redeem at booking — used by the public
 * lookup endpoint. Returns eligibility only when loyalty is on-plan + enabled
 * for the shop and the balance is worth at least $MIN_REDEEM_DOLLARS.
 */
export async function lookupRedeemable(opts: {
  shopId: string; plan: string; bookingSettings: unknown; email?: string | null; phone?: string | null;
}): Promise<{ eligible: boolean; points: number; value: number }> {
  const ls = loyaltyCfg(opts.bookingSettings);
  if (!planHasFeature(opts.plan, "loyalty") || ls?.enabled === false) return { eligible: false, points: 0, value: 0 };
  const rate = Number(ls?.redemption_rate ?? 5);
  if (!(rate > 0)) return { eligible: false, points: 0, value: 0 };
  const bal = await findBalance(opts.shopId, opts.email, opts.phone);
  const points = bal?.points ?? 0;
  const value = pointsValue(points, rate);
  return { eligible: value >= MIN_REDEEM_DOLLARS, points, value };
}

/**
 * How much a customer may actually redeem against THIS booking. Returns the
 * points to deduct + the dollar discount (capped at the pre-tax total). 0/0 when
 * not requested or not eligible. NEVER trusts a client-sent amount.
 */
export async function computeRedemption(opts: {
  shopId: string; plan: string; bookingSettings: unknown;
  email?: string | null; phone?: string | null;
  preTaxTotal: number;   // effective service total AFTER any promo, pre-tax
  requested: boolean;    // customer toggled "use my points"
}): Promise<{ points: number; discount: number }> {
  if (!opts.requested || opts.preTaxTotal <= 0) return { points: 0, discount: 0 };
  const ls = loyaltyCfg(opts.bookingSettings);
  if (!planHasFeature(opts.plan, "loyalty") || ls?.enabled === false) return { points: 0, discount: 0 };
  const rate = Number(ls?.redemption_rate ?? 5);
  if (!(rate > 0)) return { points: 0, discount: 0 };

  const bal = await findBalance(opts.shopId, opts.email, opts.phone);
  if (!bal) return { points: 0, discount: 0 };
  const value = pointsValue(bal.points, rate);
  if (value < MIN_REDEEM_DOLLARS) return { points: 0, discount: 0 };

  const discount = Math.round(Math.min(value, opts.preTaxTotal) * 100) / 100;
  const points = Math.min(bal.points, Math.round((discount / rate) * 100));
  return { points, discount };
}

/**
 * Deduct the points that back a POS / in-person loyalty discount of $N. Converts
 * the dollar discount to points at the shop's rate and deducts them, capped at the
 * client's REAL balance (deductRedeemedPoints never drives it negative). Used by
 * the POS sale routes, where the staff applies the discount and we settle the
 * points server-side. Best-effort — a points hiccup never fails a real sale.
 */
export async function redeemPointsForDiscount(opts: {
  shopId: string; email?: string | null; phone?: string | null;
  discountDollars: number; bookingSettings: unknown;
}): Promise<void> {
  if (!(opts.discountDollars > 0)) return;
  const ls = loyaltyCfg(opts.bookingSettings);
  if (ls?.enabled === false) return;
  const rate = Number(ls?.redemption_rate ?? 5);
  if (!(rate > 0)) return;
  const points = Math.round((opts.discountDollars / rate) * 100);
  await deductRedeemedPoints({ shopId: opts.shopId, email: opts.email, phone: opts.phone, points });
}

/**
 * Deduct redeemed points once the booking exists + log the redemption, in ONE
 * database step (phase68 `loyalty_adjust`): the client row is locked, the
 * deduction is capped at the real balance, and the ledger row carries the
 * booking so a cancel / no-show gives the points back automatically (trigger).
 * A booking's points are spent at most once, and never for a booking that was
 * already cancelled. A failure is logged — never silently swallowed — and never
 * rolls back a real booking or sale. Returns the points actually deducted.
 */
export async function deductRedeemedPoints(opts: {
  shopId: string; email?: string | null; phone?: string | null; points: number; appointmentId?: string | null;
}): Promise<number> {
  if (!opts.points || opts.points <= 0) return 0;
  const bal = await findBalance(opts.shopId, opts.email, opts.phone);
  if (!bal) return 0;
  const ids = { shopId: opts.shopId, clientId: bal.id, appointmentId: opts.appointmentId ?? null };
  try {
    const { data, error } = opts.appointmentId
      ? await supabaseAdmin.rpc("loyalty_redeem_for_appointment", {
          p_shop_id: opts.shopId, p_client_id: bal.id, p_points: Math.round(opts.points), p_appointment_id: opts.appointmentId,
        })
      : await supabaseAdmin.rpc("loyalty_adjust", {
          p_shop_id: opts.shopId, p_client_id: bal.id, p_delta: -Math.round(opts.points), p_action: "redeemed",
        });
    if (error) { await logLoyaltyFailure("deductRedeemedPoints", ids, error); return 0; }
    const row = Array.isArray(data) ? data[0] : data;
    return opts.appointmentId ? Number(data ?? 0) : -Number((row as { applied?: number } | null)?.applied ?? 0);
  } catch (e) {
    await logLoyaltyFailure("deductRedeemedPoints", ids, e);
    return 0;
  }
}
