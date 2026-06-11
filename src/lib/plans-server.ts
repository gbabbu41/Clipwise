// Server-only — never import in "use client" components (pulls in supabase-admin
// which uses the service-role key). Reads the `plans` table and hydrates the
// sync gating config in lib/validation.
import { supabaseAdmin } from "./supabase-admin";
import { hydratePlanConfig } from "./validation";
import { planRowsToConfig, type PlanRow } from "./plans";

let cache: { rows: PlanRow[]; at: number } | null = null;
const TTL_MS = 60_000; // plan edits land within ~1 min on already-warm servers

/** All plans (incl. inactive), ordered for display. Bypasses RLS via the
 *  service role, so callers that expose this to the public must filter
 *  is_active themselves (see /api/plans). */
export async function fetchAllPlans(): Promise<PlanRow[]> {
  const { data, error } = await supabaseAdmin
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) {
    console.warn("[plans-server] fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as PlanRow[];
}

/** Cached read (60s TTL). Empty results are not cached so a transient failure
 *  or pre-migration DB self-heals on the next call. */
export async function getPlans(force = false): Promise<PlanRow[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await fetchAllPlans();
  if (rows.length > 0) cache = { rows, at: Date.now() };
  return rows;
}

/** Fetch (cached) + hydrate the sync gating config. Call at the top of any
 *  server route that gates on plan features/limits. Returns the rows so the
 *  caller can also read prices. */
export async function ensurePlansHydrated(): Promise<PlanRow[]> {
  const rows = await getPlans();
  hydratePlanConfig(planRowsToConfig(rows));
  return rows;
}

export function getPlanById(rows: PlanRow[], id: string): PlanRow | null {
  return rows.find((r) => r.id === id) ?? null;
}

export function invalidatePlansCache() {
  cache = null;
}
