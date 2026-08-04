import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cleanupOrphanedBarberAccounts } from "@/lib/barber-cleanup";

// Remove a barber from a shop's staff. Deletes the barber's link AND — when that
// leaves a pure barber account with no other shop — frees their login so the
// email is released for a fresh signup (otherwise a removed barber is stranded on
// an "account not linked" screen and can never reuse their email).
// The account deletion reuses the guarded cleanupOrphanedBarberAccounts helper,
// which never touches owners/admins or a barber still linked to another shop.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { barber_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const barberId = body.barber_id;
  if (!barberId) return NextResponse.json({ error: "Missing barber_id" }, { status: 400 });

  // Look up the barber → its shop + linked login.
  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id, shop_id, user_id").eq("id", barberId).maybeSingle();
  if (!barber) return NextResponse.json({ ok: true, accountFreed: false }); // already gone

  // Only the shop OWNER may remove staff.
  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id").eq("id", barber.shop_id).maybeSingle();
  if (!shop || shop.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const removedUserId = barber.user_id as string | null;

  // Drop the staff link.
  const { error: delErr } = await supabaseAdmin.from("barbers").delete().eq("id", barberId);
  if (delErr) return NextResponse.json({ error: "Couldn't remove this barber. Please try again." }, { status: 500 });

  // Free the login if it's now an orphaned pure-barber account (guarded: keeps
  // owners/admins and anyone still on another shop). Best-effort — never fails
  // the removal itself.
  let freed = 0;
  if (removedUserId) {
    try { freed = await cleanupOrphanedBarberAccounts([removedUserId], user.id); } catch { /* noop */ }
  }

  return NextResponse.json({ ok: true, accountFreed: freed > 0 });
}
