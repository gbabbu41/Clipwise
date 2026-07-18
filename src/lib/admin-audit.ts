// Server-only — appends to admin_audit_log. Best-effort: a logging failure
// (incl. pre-migration when the table is missing) must never block the action
// being audited.
import { supabaseAdmin } from "./supabase-admin";

export interface AdminActor { id: string; email?: string | null }

export interface AuditParams {
  action: string;                 // e.g. "shop.approve", "plan.update", "settings.update"
  target_type?: string;           // "shop" | "plan" | "settings" | "user"
  target_id?: string | null;
  target_label?: string | null;
  meta?: Record<string, unknown>;
}

export async function logAdminAction(actor: AdminActor, p: AuditParams): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("admin_audit_log").insert({
      actor_id: actor.id,
      actor_email: actor.email ?? null,
      action: p.action,
      target_type: p.target_type ?? null,
      target_id: p.target_id ?? null,
      target_label: p.target_label ?? null,
      meta: p.meta ?? {},
    });
    if (error) console.warn("[admin-audit] insert failed:", error.message);
  } catch (e) {
    console.warn("[admin-audit] insert threw:", e);
  }
}
