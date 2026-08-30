// Server-authoritative POS commission. The POS used to send `commission_amount`
// straight from browser JS, and every write route stored it verbatim — so a
// stale/tampered rate, or a corrupt value (a bad build once stored cuts ~466×
// too large), landed in the ledger as fact. Money-deciding numbers must be
// recomputed on the server: here the RATE always comes from the DB (the barber's
// stored commission_percent), never the client. It's applied to the service base
// (service subtotal after discount) and clamped to that base — a commission can
// never exceed the service it's on (pct ≤ 100). No barber → shop revenue → null.
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function posCommissionFor(
  barberId: string | null | undefined,
  serviceBase: number,
): Promise<number | null> {
  if (!barberId) return null; // gift/product/no-barber sale → no commission
  const base = Math.max(0, Number(serviceBase) || 0);
  if (base <= 0) return 0;
  const { data: barber } = await supabaseAdmin
    .from("barbers").select("commission_percent").eq("id", barberId).maybeSingle();
  const pct = Math.min(100, Math.max(0, Number(barber?.commission_percent ?? 0)));
  return Math.round(base * (pct / 100) * 100) / 100;
}
