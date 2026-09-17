import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const drafts = await supabaseAdmin.from("marketing_signup_drafts").delete().lt("created_at", new Date(Date.now() - 48 * 3600_000).toISOString());
  const leads = await supabaseAdmin.from("marketing_leads").delete().lt("expires_at", new Date().toISOString());
  if (drafts.error || leads.error) return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
