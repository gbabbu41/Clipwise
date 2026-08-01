import { supabaseAdmin } from "@/lib/supabase-admin";

// Resolve a shop's client row for a booking, creating one if none exists, and
// return its id — used by the booking paths to stamp appointments.client_id
// (the permanent link). Deduped by email → phone, matching how the rest of the
// app decides identity. Returns null when there's nothing to key on later
// (name-only walk-in) or on error — the caller just leaves client_id unset and
// the app still groups that person by name.
export async function ensureClientRow(
  shopId: string,
  c: { name?: string | null; email?: string | null; phone?: string | null },
): Promise<string | null> {
  const name = (c.name ?? "").trim().slice(0, 80);
  const email = (c.email ?? "").trim().slice(0, 120);
  const phone = (c.phone ?? "").trim().slice(0, 30);
  if (!name) return null;
  try {
    let existing: { id: string } | null = null;
    if (email) {
      const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", shopId).ilike("email", email).maybeSingle();
      existing = data;
    }
    if (!existing && phone) {
      const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", shopId).eq("phone", phone).maybeSingle();
      existing = data;
    }
    if (existing) return existing.id;
    // Only create when there's an email or phone to dedupe on next time — a
    // pure name-only walk-in would otherwise spawn a fresh row every booking.
    if (!email && !phone) return null;
    const { data } = await supabaseAdmin.from("clients").insert({
      shop_id: shopId, name, email, phone,
      total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
    }).select("id").single();
    return data?.id ?? null;
  } catch {
    return null;
  }
}
