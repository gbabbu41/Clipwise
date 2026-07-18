import { NextResponse } from "next/server";
import { getPlatformSettings } from "@/lib/platform-settings";

// Public, non-sensitive platform status — powers the signup gate + maintenance
// banner. Returns only booleans/labels a logged-out visitor is allowed to see.
export async function GET() {
  const s = await getPlatformSettings();
  return NextResponse.json({
    platform_name: s.platform_name,
    signups_enabled: s.signups_enabled,
    maintenance_mode: s.maintenance_mode,
    maintenance_message: s.maintenance_message,
  });
}
