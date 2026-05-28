import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getAdminUser() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "super_admin" ? user : null;
}

export async function GET() {
  const admin = await getAdminUser();
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
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, status, rejection_reason } = await req.json();
  if (!id || !status) return NextResponse.json({ error: "Missing id or status" }, { status: 400 });

  const update: Record<string, string> = { status };
  if (rejection_reason) update.rejection_reason = rejection_reason;

  const { error } = await supabaseAdmin.from("shops").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
