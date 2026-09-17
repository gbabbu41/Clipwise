import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";
export async function publicSignupGate() {
  const { data, error } = await supabaseAdmin.from("platform_settings").select("data").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: "Signup is temporarily unavailable. Please try again shortly." }, { status: 503 });
  if (data?.data?.signups_enabled === false) return NextResponse.json({ error: "New signups are paused. Please check back soon." }, { status: 503 });
  return null;
}
