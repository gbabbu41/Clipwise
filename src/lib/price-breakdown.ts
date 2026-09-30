// How a price was reached — the promo code and loyalty points behind a discounted
// total (phase72 `price_breakdown` on appointments + transactions). Display-only:
// money math keeps using total_amount / tax_amount / amount. Shared by the server
// (writes it, alerts, emails) and the UI (calendar, Payments), so every surface
// words it the same way. No server imports — safe in the browser.

export type PriceBreakdown = {
  subtotal?: number;          // service price before any discount (pre-tax)
  promo_code?: string;
  promo_discount?: number;
  loyalty_points?: number;
  loyalty_discount?: number;
};

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const pos = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0);

/** Build the stored breakdown, or null when nothing was discounted. */
export function buildPriceBreakdown(p: {
  subtotal?: number | null;
  promoCode?: string | null; promoDiscount?: number | null;
  loyaltyPoints?: number | null; loyaltyDiscount?: number | null;
}): PriceBreakdown | null {
  const promo = pos(p.promoDiscount);
  const loyalty = pos(p.loyaltyDiscount);
  if (!promo && !loyalty) return null;
  const out: PriceBreakdown = {};
  if (pos(p.subtotal)) out.subtotal = pos(p.subtotal);
  if (promo) { out.promo_discount = promo; if (p.promoCode) out.promo_code = String(p.promoCode); }
  if (loyalty) { out.loyalty_discount = loyalty; const pts = Math.round(Number(p.loyaltyPoints) || 0); if (pts > 0) out.loyalty_points = pts; }
  return out;
}

/** Read a stored breakdown defensively (jsonb from the DB / API). */
export function readPriceBreakdown(v: unknown): PriceBreakdown | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const pb: PriceBreakdown = {};
  if (pos(r.subtotal)) pb.subtotal = pos(r.subtotal);
  if (pos(r.promo_discount)) { pb.promo_discount = pos(r.promo_discount); if (typeof r.promo_code === "string" && r.promo_code) pb.promo_code = r.promo_code; }
  if (pos(r.loyalty_discount)) { pb.loyalty_discount = pos(r.loyalty_discount); if (pos(r.loyalty_points)) pb.loyalty_points = Math.round(Number(r.loyalty_points)); }
  return pb.promo_discount || pb.loyalty_discount ? pb : null;
}

/** Discount lines for a receipt / detail panel: [{ label, amount (negative) }]. */
export function discountLines(v: unknown): { label: string; amount: number }[] {
  const pb = readPriceBreakdown(v);
  if (!pb) return [];
  const lines: { label: string; amount: number }[] = [];
  if (pb.promo_discount) lines.push({ label: pb.promo_code ? `Promo ${pb.promo_code}` : "Promo", amount: -pb.promo_discount });
  if (pb.loyalty_discount) lines.push({ label: pb.loyalty_points ? `Loyalty points (${pb.loyalty_points} pts)` : "Loyalty points", amount: -pb.loyalty_discount });
  return lines;
}

/** One-line summary for alerts: "423 pts −$21.15 · promo SAVE10 −$5.00". "" when none. */
export function discountSummary(v: unknown): string {
  const pb = readPriceBreakdown(v);
  if (!pb) return "";
  const parts: string[] = [];
  if (pb.loyalty_discount) parts.push(`${pb.loyalty_points ? `${pb.loyalty_points} pts` : "points"} −${money(pb.loyalty_discount)}`);
  if (pb.promo_discount) parts.push(`promo${pb.promo_code ? ` ${pb.promo_code}` : ""} −${money(pb.promo_discount)}`);
  return parts.join(" · ");
}

/** Email field: "Loyalty points (423 pts)::−$21.15||Promo SAVE10::−$5.00" ("" when none). */
export function discountEmailField(v: unknown): string {
  return discountLines(v).map(d => `${d.label}::−${money(-d.amount)}`).join("||");
}
