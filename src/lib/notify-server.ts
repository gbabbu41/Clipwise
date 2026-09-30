import { supabaseAdmin } from "@/lib/supabase-admin";
import type { NotificationInput } from "@/lib/notify";
import { humanizeDates } from "@/lib/utils";

/**
 * SERVER-ONLY notification writer. Lives apart from `lib/notify.ts` (which holds
 * the client-safe read helpers) because it imports `supabaseAdmin` — pulling that
 * service-role client into a browser bundle throws "supabaseKey is required" at
 * module load (SUPABASE_SERVICE_ROLE_KEY is undefined in the browser) and blanks
 * the whole page. Never import this from a "use client" component.
 *
 * Dates in the message are humanized centrally (humanizeDates).
 * ALWAYS stamps shop_id; if the column (or entity_*) is missing, retries without
 * it so a lagging migration never silently drops an alert. Fire-and-forget.
 */
export async function insertNotifications(rows: NotificationInput | NotificationInput[]): Promise<void> {
  // Raw "YYYY-MM-DD" never reaches a person — formatted here for every caller.
  const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ is_read: false, ...r, message: humanizeDates(r.message) }));
  if (list.length === 0) return;
  const { error } = await supabaseAdmin.from("notifications").insert(list);
  if (!error) return;
  if (/shop_id|entity_(type|id)/.test(error.message)) {
    const stripped = list.map((r) => {
      const { shop_id: _s, entity_type: _t, entity_id: _i, ...base } = r;
      return base;
    });
    await supabaseAdmin.from("notifications").insert(stripped).then(null, () => null);
  }
}
