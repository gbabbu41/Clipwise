// Pure pricing math for tips + sales tax. Used by the booking page, POS, the
// tip-link flow, and the server charge routes so every surface agrees on the
// dollar amounts. No side effects, fully unit-testable.

// Canadian sales-tax presets for personal services (haircuts are taxable).
// HST provinces are exact; GST-only provinces use the 5% federal baseline —
// where a province also charges PST on services (varies), the owner edits the
// rate. `label` is what shows on the receipt.
export const CANADA_TAX_PRESETS: { province: string; label: string; rate: number; note?: string }[] = [
  { province: "NB", label: "HST", rate: 15 },
  { province: "NL", label: "HST", rate: 15 },
  { province: "NS", label: "HST", rate: 15 },
  { province: "PE", label: "HST", rate: 15 },
  { province: "ON", label: "HST", rate: 13 },
  { province: "QC", label: "GST+QST", rate: 14.975 },
  { province: "AB", label: "GST", rate: 5 },
  { province: "BC", label: "GST", rate: 5, note: "PST generally not charged on haircuts — verify for retail products" },
  { province: "MB", label: "GST", rate: 5, note: "Add PST if you sell taxable products" },
  { province: "SK", label: "GST", rate: 5, note: "SK PST may apply to some services — verify" },
  { province: "NT", label: "GST", rate: 5 },
  { province: "NU", label: "GST", rate: 5 },
  { province: "YT", label: "GST", rate: 5 },
];

/** Normalize a GST/HST number for storage/display: strip spaces + dashes, upper-case. */
export function normalizeGstNumber(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/**
 * A valid Canadian GST/HST number is a 9-digit Business Number, optionally with
 * the "RT" program account + 4-digit reference (e.g. 123456789RT0001). We accept
 * BOTH the bare BN and the full RT form so owners aren't blocked on formatting.
 * (This is a format check only — CRA-registry verification is a later phase.)
 */
export function isValidGstNumber(raw: string | null | undefined): boolean {
  const s = normalizeGstNumber(raw);
  return /^\d{9}$/.test(s) || /^\d{9}RT\d{4}$/.test(s);
}

/** A shop only charges tax when it's flagged taxable AND a GST/HST number is on
 *  file — you can't legally charge tax unless you're registered. Single source of
 *  truth used by every charge path so the rule is consistent. */
export function shopChargesTax(bs: { tax_enabled?: boolean; tax_number?: string | null } | null | undefined): boolean {
  return !!bs && bs.tax_enabled === true && isValidGstNumber(bs.tax_number);
}

export type TaxConfig = {
  tax_enabled?: boolean; tax_number?: string | null; tax_rate?: number; tax_label?: string;
  pst_enabled?: boolean; pst_rate?: number; pst_label?: string; pst_number?: string | null;
};
export type TaxLine = { label: string; rate: number };

/**
 * The tax lines a shop charges: GST/HST always (when registered), plus a
 * SEPARATE provincial tax (PST/QST/RST) when the owner opted in — for BC / SK /
 * MB / QC. Returns [] when the shop isn't charging tax. Drives both the total
 * (sum of rates) and the receipt breakdown (one line each) so they always agree.
 */
export function taxLinesFor(bs: TaxConfig | null | undefined): TaxLine[] {
  if (!shopChargesTax(bs ?? undefined)) return [];
  const lines: TaxLine[] = [];
  const gstRate = clampTaxRate(Number(bs!.tax_rate ?? 0));
  if (gstRate > 0) lines.push({ label: (bs!.tax_label || "GST/HST").trim() || "GST/HST", rate: gstRate });
  if (bs!.pst_enabled) {
    const pstRate = clampTaxRate(Number(bs!.pst_rate ?? 0));
    if (pstRate > 0) lines.push({ label: (bs!.pst_label || "PST").trim() || "PST", rate: pstRate });
  }
  return lines;
}

/** Combined tax rate (GST/HST + optional PST) as a single percent. */
export function combinedTaxRate(bs: TaxConfig | null | undefined): number {
  return taxLinesFor(bs).reduce((sum, l) => sum + l.rate, 0);
}

/**
 * THE single source of truth for how much tax (in dollars) a shop charges on a
 * given PRE-TAX service amount. Every server charge path (booking checkout, POS,
 * payment links, capture) resolves tax through here so they can never disagree.
 * Returns 0 when the shop isn't charging tax (not registered / toggle off).
 */
export function taxOnAmount(preTaxDollars: number, bs: TaxConfig | null | undefined): number {
  if (!shopChargesTax(bs ?? undefined)) return 0;
  return taxCents(Math.round((preTaxDollars || 0) * 100), combinedTaxRate(bs)) / 100;
}

/** The single combined tax label for receipts / line items (e.g. "HST" or
 *  "HST + PST"). Empty string when the shop isn't charging tax. */
export function taxLabelFor(bs: TaxConfig | null | undefined): string {
  return taxLinesFor(bs).map(l => l.label).join(" + ");
}

export function taxPresetFor(province: string | null | undefined) {
  if (!province) return null;
  const p = province.trim().toUpperCase();
  return CANADA_TAX_PRESETS.find(t => t.province === p) ?? null;
}

/** Clamp a tax rate to a sane range (0–30%). */
export function clampTaxRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.min(30, Math.round(rate * 1000) / 1000);
}

/** Tax in cents on a taxable base (already net of any discount). Rounded to the cent. */
export function taxCents(taxableBaseCents: number, ratePct: number): number {
  const base = Math.max(0, Math.round(taxableBaseCents));
  const rate = clampTaxRate(ratePct);
  if (base === 0 || rate === 0) return 0;
  return Math.round(base * rate / 100);
}

/** Tip in cents for a percent of a base amount (rounded to the cent). */
export function tipCentsForPercent(baseCents: number, pct: number): number {
  const base = Math.max(0, Math.round(baseCents));
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round(base * pct / 100);
}

export interface ChargeBreakdown {
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;   // subtotal − discount (never below 0)
  taxCents: number;
  tipCents: number;
  totalCents: number;     // taxable + tax + tip
}

/**
 * The single source of truth for a charge total. Tax applies to the service
 * amount AFTER discount; tip is added AFTER tax (tips aren't taxed).
 */
export function computeCharge(input: {
  subtotalCents: number;
  discountCents?: number;
  taxRatePct?: number;
  tipCents?: number;
}): ChargeBreakdown {
  const subtotalCents = Math.max(0, Math.round(input.subtotalCents || 0));
  const discountCents = Math.min(subtotalCents, Math.max(0, Math.round(input.discountCents || 0)));
  const taxableCents = subtotalCents - discountCents;
  const tax = taxCents(taxableCents, input.taxRatePct || 0);
  const tip = Math.max(0, Math.round(input.tipCents || 0));
  return {
    subtotalCents, discountCents, taxableCents,
    taxCents: tax, tipCents: tip,
    totalCents: taxableCents + tax + tip,
  };
}

// Standard customer-facing tip choices (percent of the taxable service amount).
export const TIP_PRESET_PERCENTS = [15, 18, 20];
