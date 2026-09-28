import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * A payment SUCCEEDED but its ledger (transactions) row could not be saved.
 * Recorded in the existing error_logs table (the admin error panel) with only
 * the ids needed to find it — shop, booking, payment id — never amounts, names
 * or emails. Never throws: logging must not disturb the (already-charged) flow.
 */
export async function logLedgerSaveFailure(
  where: string,
  ids: { shopId?: string | null; appointmentId?: string | null; paymentIntentId?: string | null },
  error: unknown,
): Promise<void> {
  const reason = (error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "unknown error")).slice(0, 300);
  const message = `Ledger save failed after a successful payment (${where}): appointment ${ids.appointmentId ?? "n/a"}, payment ${ids.paymentIntentId ?? "n/a"} — ${reason}`;
  console.error("[ledger-save]", message);
  try {
    await supabaseAdmin.from("error_logs").insert({
      level: "error", source: "ledger-save", message, path: where, shop_id: ids.shopId ?? null,
    });
  } catch { /* best-effort */ }
}
