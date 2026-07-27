import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isValidGstNumber, normalizeGstNumber } from "@/lib/pricing";

/**
 * Save the owner's GST/HST registration number ONCE for ALL their shops. A
 * registered business has a single number (the legal entity's), so it's shared
 * across every location — we write it into each shop's booking_settings JSON
 * (merging, so per-shop rate/other settings are untouched). The tax RATE stays
 * per-shop (province-driven); only the number is shared. Owner-only.
 *
 * Body: { gst_number }  (empty string clears it)
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { gst_number } = await request.json() as { gst_number?: string };
  const raw = (gst_number ?? "").trim();
  if (raw && !isValidGstNumber(raw)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid GST/HST number (e.g. 123456789RT0001)." },
      { status: 400 },
    );
  }
  const normalized = raw ? normalizeGstNumber(raw) : "";

  const { data: shops } = await supabaseAdmin
    .from("shops").select("id, booking_settings").eq("owner_id", user.id);
  if (!shops || shops.length === 0) {
    return NextResponse.json({ error: "No shops found for this owner." }, { status: 404 });
  }

  for (const s of shops) {
    const bs = (s.booking_settings ?? {}) as Record<string, unknown>;
    await supabaseAdmin.from("shops")
      .update({ booking_settings: { ...bs, tax_number: normalized } })
      .eq("id", s.id).then(null, () => null);
  }

  return NextResponse.json({ ok: true, gst_number: normalized, shops: shops.length });
}
