import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Register a customer into a shop's `clients` book — SERVICE ROLE, deduped by
 * email → phone (case-insensitive email). Idempotent + fire-and-forget: it never
 * throws, so a failure can't roll back a recorded sale. Mirrors /api/clients/upsert
 * so a POS sale lands the customer in the SAME `clients` table the Clients page and
 * the booking flow read. This is the reliable path: the browser-side insert can
 * silently fail, and a barber running POS has NO client-side INSERT rights on
 * `clients` at all — the service role here bypasses that.
 *
 * Skips junk: no name / the default "Walk-in" / no contact at all (a name with no
 * email AND no phone isn't a reachable customer, so it's not booked into Clients).
 */
export async function upsertClient(
  shopId: string,
  name?: string | null,
  email?: string | null,
  phone?: string | null,
): Promise<void> {
  const nm = (name ?? "").trim().slice(0, 80);
  const e = (email ?? "").trim().slice(0, 120);
  const p = (phone ?? "").trim().slice(0, 30);
  if (!shopId || !nm || nm.toLowerCase() === "walk-in" || (!e && !p)) return;
  try {
    let existing: { id: string } | null = null;
    if (e) {
      const { data } = await supabaseAdmin
        .from("clients").select("id").eq("shop_id", shopId).ilike("email", e).maybeSingle();
      existing = data;
    }
    if (!existing && p) {
      const { data } = await supabaseAdmin
        .from("clients").select("id").eq("shop_id", shopId).eq("phone", p).maybeSingle();
      existing = data;
    }
    if (existing) return; // already on file — deduped
    const { error } = await supabaseAdmin.from("clients").insert({
      shop_id: shopId, name: nm, email: e, phone: p,
      total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
    });
    if (error) console.error("[pos] client upsert failed:", error.message);
  } catch (err) {
    console.error("[pos] client upsert error:", err instanceof Error ? err.message : err);
  }
}
