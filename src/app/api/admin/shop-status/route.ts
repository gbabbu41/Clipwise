import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { shopId, status, rejection_reason } = await req.json();
  if (!shopId || !status) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const update: Record<string, string> = { status };
  if (rejection_reason) update.rejection_reason = rejection_reason;

  const { error } = await supabaseAdmin.from("shops").update(update).eq("id", shopId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
