import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Fetch all data using admin client (bypasses RLS)
  const [{ data: shops }, { data: transactions }, { data: appointments }, { count: userCount }] = await Promise.all([
    supabaseAdmin.from("shops").select("*, users(name, email)").order("created_at", { ascending: false }),
    supabaseAdmin.from("transactions").select("amount"),
    supabaseAdmin.from("appointments").select("id"),
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({ shops: shops ?? [], transactions: transactions ?? [], appointments: appointments ?? [], userCount: userCount ?? 0 });
}

async function requireSuperAdmin(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "super_admin" ? user : null;
}

export async function PATCH(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, status, rejection_reason } = await req.json();
  if (!id || !status) return NextResponse.json({ error: "Missing id or status" }, { status: 400 });

  const update: Record<string, string> = { status };
  if (rejection_reason) update.rejection_reason = rejection_reason;

  const { error } = await supabaseAdmin.from("shops").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
