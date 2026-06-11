// Shared (client + server safe) plan types and helpers.
// The DB row shape for public.plans, plus the mapping into the sync gating
// config consumed by lib/validation. No server-only imports here.
import type { PlanFeature, PlanConfigEntry } from "./validation";

export interface PlanRow {
  id: string;
  name: string;
  price_cents: number;
  barber_limit: number | null; // null = unlimited
  features: PlanFeature[];
  highlights: string[];
  badge: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

/** Map DB rows → the { barberLimit, features } config the sync helpers read.
 *  A null barber_limit becomes Infinity (unlimited). */
export function planRowsToConfig(rows: PlanRow[]): Record<string, PlanConfigEntry> {
  const cfg: Record<string, PlanConfigEntry> = {};
  for (const r of rows) {
    cfg[r.id] = {
      barberLimit: r.barber_limit == null ? Infinity : r.barber_limit,
      features: Array.isArray(r.features) ? r.features : [],
    };
  }
  return cfg;
}

/** "$23", "$49.50", or "Free" for a 0-cent plan. */
export function formatPlanPrice(priceCents: number): string {
  if (!priceCents) return "Free";
  const dollars = priceCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}
