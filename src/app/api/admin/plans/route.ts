import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { invalidatePlansCache } from "@/lib/plans-server";
import { ALL_PLAN_FEATURES } from "@/lib/validation";

// Admin-only CRUD for the `plans` table (super_admin = gbabbu41). Reads go
// through the service role and are gated here in code; the DB RLS is a second
// line of defence. Every write busts the plans cache so prices/feature gates
// take effect on the next request.

async function requireSuperAdmin(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "super_admin" ? user : null;
}

// GET — all plans (incl. inactive) for the admin editor.
export async function GET(req: NextRequest) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await supabaseAdmin.from("plans").select("*").order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plans: data ?? [] });
}

// PUT — create or update a plan (upsert by id).
export async function PUT(req: NextRequest) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();

  const id = String(body.id ?? "").trim().toLowerCase();
  if (!id || !/^[a-z0-9_]+$/.test(id)) {
    return NextResponse.json({ error: "Plan id must be lowercase letters, numbers or underscores (e.g. 'premium')." }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Plan name is required." }, { status: 400 });

  const price_cents = Math.round(Number(body.price_cents));
  if (!Number.isFinite(price_cents) || price_cents < 0) {
    return NextResponse.json({ error: "Price must be a number ≥ 0." }, { status: 400 });
  }

  let barber_limit: number | null = null;
  if (body.barber_limit !== null && body.barber_limit !== "" && body.barber_limit !== undefined) {
    barber_limit = Math.round(Number(body.barber_limit));
    if (!Number.isFinite(barber_limit) || barber_limit < 1) {
      return NextResponse.json({ error: "Barber limit must be empty (unlimited) or a whole number ≥ 1." }, { status: 400 });
    }
  }

  const features = Array.isArray(body.features)
    ? body.features.filter((f: unknown): f is string => typeof f === "string" && (ALL_PLAN_FEATURES as string[]).includes(f))
    : [];
  const highlights = Array.isArray(body.highlights)
    ? body.highlights.map((h: unknown) => String(h).trim()).filter(Boolean)
    : [];

  const row = {
    id,
    name,
    price_cents,
    barber_limit,
    features,
    highlights,
    badge: body.badge ? String(body.badge).trim() : null,
    description: body.description ? String(body.description).trim() : null,
    is_active: body.is_active !== false,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Math.round(Number(body.sort_order)) : 0,
  };

  const { data, error } = await supabaseAdmin.from("plans").upsert(row, { onConflict: "id" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidatePlansCache();
  return NextResponse.json({ ok: true, plan: data });
}

// DELETE ?id=slug — only when no shop is on the plan (else deactivate instead).
export async function DELETE(req: NextRequest) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { count, error: countErr } = await supabaseAdmin
    .from("shops").select("id", { count: "exact", head: true }).eq("subscription_plan", id);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: `${count} shop(s) are on this plan. Deactivate it instead of deleting.` }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("plans").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidatePlansCache();
  return NextResponse.json({ ok: true });
}
