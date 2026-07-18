import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import {
  getPlatformSettings, invalidatePlatformSettingsCache,
  SETTINGS_STRING_KEYS, SETTINGS_BOOL_KEYS, type PlatformSettings,
} from "@/lib/platform-settings";

// GET — current platform settings (super-admin only).
export async function GET(req: NextRequest) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const settings = await getPlatformSettings(true);
  return NextResponse.json({ settings });
}

// PUT — merge + persist. Only whitelisted keys are accepted; everything else in
// the body is ignored so a crafted request can't inject arbitrary config.
export async function PUT(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const current = await getPlatformSettings(true);
  const next: PlatformSettings = { ...current };

  for (const k of SETTINGS_STRING_KEYS) {
    if (typeof body[k] === "string") next[k] = (body[k] as string).slice(0, 300);
  }
  for (const k of SETTINGS_BOOL_KEYS) {
    if (typeof body[k] === "boolean") next[k] = body[k] as boolean;
  }

  const { error } = await supabaseAdmin.from("platform_settings").upsert(
    { id: 1, data: next, updated_at: new Date().toISOString(), updated_by: admin.id },
    { onConflict: "id" },
  );
  if (error) {
    // Almost always "relation platform_settings does not exist" pre-migration.
    return NextResponse.json({ error: "Couldn't save — run the phase27 migration first." }, { status: 500 });
  }

  invalidatePlatformSettingsCache();
  await logAdminAction(admin, { action: "settings.update", target_type: "settings", target_label: "Platform settings", meta: { ...next } as Record<string, unknown> });
  return NextResponse.json({ ok: true, settings: next });
}
