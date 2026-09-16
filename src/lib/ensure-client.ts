import { supabaseAdmin } from "@/lib/supabase-admin";
import { normPhone } from "@/lib/client-identity";

// Resolve a shop's client row for a booking, creating one if none exists, and
// return its id — used by the booking paths to stamp appointments.client_id
// (the permanent link). Deduped by email → phone → name, matching how the rest
// of the app decides identity. EVERY named guest is logged into the client book
// (a name-only walk-in included), so "add an appointment for a new person" always
// files them under Clients. Returns null only when there's no name at all, or on
// error — the caller then just leaves client_id unset.
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
    const np = normPhone(phone);
    if (!existing && np) {
      // Match on the NORMALIZED phone (digits, last 10) so a returning customer
      // whose number was typed in a different format is still recognized.
      const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", shopId).eq("phone_normalized", np).limit(1);
      existing = data?.[0] ?? null;
    }
    // Name-only guest (no email/phone to key on): dedupe by the trimmed name
    // (case-insensitive) so a repeat walk-in links to the SAME row instead of
    // spawning a fresh "John" every visit — the app already groups by name, so
    // this keeps the client book clean while still logging the guest.
    if (!existing && !email && !np) {
      const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", shopId).ilike("name", name).limit(1);
      existing = data?.[0] ?? null;
    }
    if (existing) return existing.id;
    // Create the client — including a name-only walk-in. email/phone go in as
    // NULL (not "") when absent so the generated phone_normalized stays null and
    // the row reads cleanly. (phone_normalized is a GENERATED column — never set
    // it here or the insert is rejected.)
    const { data } = await supabaseAdmin.from("clients").insert({
      shop_id: shopId, name,
      email: email || null,
      phone: phone || null,
      total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
    }).select("id").single();
    return data?.id ?? null;
  } catch {
    return null;
  }
}
