import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop } from "@/lib/api-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { findExistingClient } from "@/lib/ensure-client";

/**
 * The ONE authenticated door for creating a client from inside the portal
 * (owner + barber). Every manual "add client" — the Clients page, POS, the
 * appointment sheets' new-client flow — goes through here, so the same three
 * guarantees always hold:
 *
 *   1. AUTHENTICATION — a valid Supabase bearer token is required.
 *   2. AUTHORIZATION (IDOR) — the caller must own, or be an active barber of,
 *      the shop they're adding a client to. You can't add a client to a shop
 *      that isn't yours by POSTing its id.
 *   3. DEDUPE — email → phone → name, via the shared findExistingClient, so the
 *      same person is never saved twice (an existing match is returned instead).
 *
 * On SQL injection: there is no string-built SQL here. Every value is passed to
 * Supabase as a bound parameter (never concatenated into a query), so a "'; DROP
 * TABLE" in a name is just stored as literal text. What we DO enforce is length
 * bounds, so an unbounded payload can't bloat the row / trip a CHECK constraint.
 *
 * Returns { ok, id, duplicate } — duplicate:true means an existing client
 * matched and its id is returned (nothing new was created).
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "clients-create", 30, 60_000);
  if (limited) return limited;

  const body = await request.json().catch(() => ({})) as {
    shop_id?: string;
    name?: string;
    email?: string;
    phone?: string;
    notes?: string;
    birthday?: string; // YYYY-MM-DD
  };

  const name = (body.name ?? "").trim().slice(0, 80);
  if (!body.shop_id || !name) {
    return NextResponse.json({ ok: false, error: "A name is required." }, { status: 400 });
  }

  // 1 + 2: authenticate the caller and confirm they belong to this shop.
  const auth = await authorizeShop(request, body.shop_id);
  if ("error" in auth) return auth.error;

  // Bound every field before it touches the DB.
  const email = (body.email ?? "").trim().slice(0, 120);
  const phone = (body.phone ?? "").trim().slice(0, 30);
  const notes = (body.notes ?? "").trim().slice(0, 1000) || null;
  const birthdayRaw = (body.birthday ?? "").trim();
  // Only accept a real ISO date; anything else becomes null (never a bad value).
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(birthdayRaw) ? birthdayRaw : null;

  try {
    // 3: dedupe — return the existing client instead of a second row (with its
    // basic fields so the caller can show "already on file: …").
    const existing = await findExistingClient(body.shop_id, { name, email, phone });
    if (existing) {
      const { data: dup } = await supabaseAdmin
        .from("clients").select("id, name, email, phone").eq("id", existing).maybeSingle();
      return NextResponse.json({ ok: true, id: existing, duplicate: true, client: dup ?? { id: existing } });
    }

    // phone_normalized is a GENERATED column — never set it here. email/phone go
    // in as NULL when blank so the row (and the generated normalized phone) stay
    // clean.
    const { data, error } = await supabaseAdmin.from("clients").insert({
      shop_id: body.shop_id,
      name,
      email: email || null,
      phone: phone || null,
      notes,
      birthday,
      total_visits: 0,
      total_spent: 0,
      loyalty_points: 0,
      tag: "New",
    }).select("id, name, email, phone").single();

    if (error || !data) {
      // Detail to the server log, a generic message to the client.
      console.error("[clients/create] insert failed:", error?.message);
      return NextResponse.json({ ok: false, error: "Couldn't save the client. Please try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: data.id, duplicate: false, client: data });
  } catch (err) {
    console.error("[clients/create] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Couldn't save the client. Please try again." }, { status: 500 });
  }
}
