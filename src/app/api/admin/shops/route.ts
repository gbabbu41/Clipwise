import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function requireSuperAdmin(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  console.log("[admin] token present:", !!token, "| length:", token?.length ?? 0);
  if (!token) return null;
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  console.log("[admin] user:", user?.id ?? "null", "| authError:", authError?.message ?? "none");
  if (!user) return null;
  const { data: profile, error: profileError } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  console.log("[admin] role:", profile?.role ?? "null", "| profileError:", profileError?.message ?? "none");
  return profile?.role === "super_admin" ? user : null;
}

export async function GET(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ data: shops }, { data: transactions }, { data: appointments }, { count: userCount }] = await Promise.all([
    supabaseAdmin.from("shops").select("*, users(name, email)").order("created_at", { ascending: false }),
    supabaseAdmin.from("transactions").select("amount"),
    supabaseAdmin.from("appointments").select("id"),
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({ shops: shops ?? [], transactions: transactions ?? [], appointments: appointments ?? [], userCount: userCount ?? 0 });
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
