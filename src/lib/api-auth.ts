// Server-only — shared authorization gate for API routes that write, move money,
// send messages, or read private data. Mirrors the pattern proven in
// pos/cash-sale: verify the Supabase bearer token, then confirm the caller is the
// shop owner OR an active barber of that shop (optionally with a specific
// permission). Routes that used the service role with NO caller check are the
// exact class of bug this centralizes away.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";
import type { User } from "@supabase/supabase-js";

export function getBearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!h) return null;
  return h.replace(/^Bearer\s+/i, "").trim() || null;
}

/** Verify the bearer token and return the authenticated user, or null. */
export async function getUserFromReq(req: Request): Promise<User | null> {
  const token = getBearer(req);
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user ?? null;
}

type BarberPermission = "manage_appointments" | "block_hours" | "manage_inventory" | "view_analytics";

interface ShopAuthOk {
  user: User;
  /** Full shop row (server-side use only — never return this verbatim to a client). */
  shop: Record<string, unknown> & { id: string; owner_id: string | null };
  isOwner: boolean;
}
type ShopAuthResult = { error: NextResponse } | ShopAuthOk;

/**
 * Authorize a caller against a shop. Returns `{ error }` (a ready-to-return
 * NextResponse) on any failure, otherwise `{ user, shop, isOwner }`.
 *
 * opts.ownerOnly    → only the shop owner passes (barbers rejected).
 * opts.permission   → a non-owner barber must have this permission flag true.
 *
 * Usage:
 *   const auth = await authorizeShop(req, shop_id);
 *   if ("error" in auth) return auth.error;
 *   const { user, shop, isOwner } = auth;
 */
export async function authorizeShop(
  req: Request,
  shopId: string | undefined | null,
  opts?: { ownerOnly?: boolean; permission?: BarberPermission },
): Promise<ShopAuthResult> {
  const user = await getUserFromReq(req);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!shopId) return { error: NextResponse.json({ error: "Missing shop" }, { status: 400 }) };

  const { data: shop } = await supabaseAdmin
    .from("shops").select("*").eq("id", shopId).maybeSingle();
  if (!shop) return { error: NextResponse.json({ error: "Shop not found" }, { status: 404 }) };

  const isOwner = shop.owner_id === user.id;
  if (isOwner) return { user, shop, isOwner: true };
  if (opts?.ownerOnly) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id, permissions")
    .eq("shop_id", shopId).eq("user_id", user.id).eq("is_active", true).maybeSingle();
  if (!barber) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  if (opts?.permission) {
    const perms = (barber.permissions ?? {}) as Record<string, boolean>;
    if (perms[opts.permission] !== true) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
  }
  return { user, shop, isOwner: false };
}

interface ApptAuthOk extends ShopAuthOk {
  appointment: Record<string, unknown> & { id: string; shop_id: string };
}
type ApptAuthResult = { error: NextResponse } | ApptAuthOk;

/**
 * Authorize a caller against an appointment by loading it, resolving its shop,
 * and running authorizeShop on that shop. Prevents IDOR on any route that takes
 * an appointment_id from the client (mark-paid, cancel-link, send-link, etc.).
 */
export async function authorizeAppointment(
  req: Request,
  appointmentId: string | undefined | null,
  opts?: { ownerOnly?: boolean; permission?: BarberPermission },
): Promise<ApptAuthResult> {
  if (!appointmentId) return { error: NextResponse.json({ error: "Missing appointment" }, { status: 400 }) };
  const { data: appt } = await supabaseAdmin
    .from("appointments").select("*").eq("id", appointmentId).maybeSingle();
  if (!appt) return { error: NextResponse.json({ error: "Appointment not found" }, { status: 404 }) };

  const auth = await authorizeShop(req, appt.shop_id, opts);
  if ("error" in auth) return auth;
  return { ...auth, appointment: appt };
}
