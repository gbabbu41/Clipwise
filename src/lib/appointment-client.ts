import type { SupabaseClient } from "@supabase/supabase-js";

// Which saved client an appointment belongs to — ONE rule for every completion
// path (points, visit/spend stats), browser or server. No server imports.
//
// The saved link (appointments.client_id) wins: it's the identity anchor
// (client-identity.ts), and a walk-in saved by name only has no email or phone
// to match on — matching by contact alone meant those clients never earned
// points or got a visit counted (2026-10-02 smoke test: "Jake", gift-card visit).
// Older bookings without the link fall back to email (case-insensitive, exact)
// then phone, as before.

/** `%` and `_` are LIKE wildcards — escape them so an email only ever matches itself. */
export const exactIlike = (v: string): string => v.replace(/[\\%_]/g, c => `\\${c}`);

type ApptContact = { client_id?: string | null; client_email?: string | null; client_phone?: string | null };

export async function findAppointmentClient<T extends { id: string }>(
  db: SupabaseClient, shopId: string, appt: ApptContact, columns: string,
): Promise<T | null> {
  const id = (appt.client_id ?? "").trim();
  if (id) {
    const { data } = await db.from("clients").select(columns).eq("shop_id", shopId).eq("id", id).maybeSingle();
    if (data) return data as unknown as T;
  }
  const email = (appt.client_email ?? "").trim();
  if (email) {
    const { data } = await db.from("clients").select(columns).eq("shop_id", shopId).ilike("email", exactIlike(email)).maybeSingle();
    if (data) return data as unknown as T;
  }
  const phone = (appt.client_phone ?? "").trim();
  if (phone) {
    const { data } = await db.from("clients").select(columns).eq("shop_id", shopId).eq("phone", phone).maybeSingle();
    if (data) return data as unknown as T;
  }
  return null;
}
