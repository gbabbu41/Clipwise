import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Customer opt-in to the smart waitlist for a fully-booked day.
 * Called from the public booking page (no auth) when a day has no openings.
 * Runs with the service-role key so it bypasses RLS (no anon insert policy
 * exists on purpose — see phase3_appointment_waitlist.sql).
 *
 * Body: { shop_id | shop_slug, desired_date, client_name, client_email?,
 *         client_phone?, barber_id?, service_id? }
 */
export async function POST(request: NextRequest) {
  try {
    const b = await request.json() as {
      shop_id?: string;
      shop_slug?: string;
      desired_date?: string;
      client_name?: string;
      client_email?: string;
      client_phone?: string;
      barber_id?: string | null;
      service_id?: string | null;
    };

    if (!b.desired_date || !b.client_name?.trim()) {
      return NextResponse.json({ error: "Missing name or date" }, { status: 400 });
    }
    if (!b.client_email && !b.client_phone) {
      return NextResponse.json({ error: "Enter an email or phone so we can reach you" }, { status: 400 });
    }

    // Resolve shop by id or slug.
    let shopId = b.shop_id ?? null;
    if (!shopId && b.shop_slug) {
      const { data: shop } = await supabaseAdmin
        .from("shops").select("id").eq("slug", b.shop_slug).maybeSingle();
      shopId = shop?.id ?? null;
    }
    if (!shopId) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

    // Dedupe: same shop + date + contact already waiting → no duplicate row.
    const { data: existing } = await supabaseAdmin
      .from("appointment_waitlist")
      .select("id")
      .eq("shop_id", shopId)
      .eq("desired_date", b.desired_date)
      .eq("status", "waiting")
      .or(`client_email.eq.${b.client_email ?? "___none___"},client_phone.eq.${b.client_phone ?? "___none___"}`)
      .maybeSingle();
    if (existing) return NextResponse.json({ ok: true, deduped: true });

    const { data: wl, error } = await supabaseAdmin.from("appointment_waitlist").insert({
      shop_id: shopId,
      barber_id: b.barber_id || null,
      service_id: b.service_id || null,
      client_name: b.client_name.trim(),
      client_email: b.client_email?.trim() || null,
      client_phone: b.client_phone?.trim() || null,
      desired_date: b.desired_date,
      status: "waiting",
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Inform the shop owner AND the relevant barber(s) in-app so they can accept
    // and assign a slot. Requested barber → just them; "any" → all active barbers.
    try {
      const [{ data: shopRow }, barbersRes] = await Promise.all([
        supabaseAdmin.from("shops").select("owner_id").eq("id", shopId).maybeSingle(),
        (b.barber_id
          ? supabaseAdmin.from("barbers").select("user_id").eq("id", b.barber_id)
          : supabaseAdmin.from("barbers").select("user_id").eq("shop_id", shopId).eq("is_active", true)),
      ]);
      const recipients = new Set<string>();
      if (shopRow?.owner_id) recipients.add(shopRow.owner_id);
      (barbersRes.data ?? []).forEach((x: { user_id: string | null }) => { if (x.user_id) recipients.add(x.user_id); });
      if (recipients.size > 0) {
        const niceDate = new Date(`${b.desired_date}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
        const base = Array.from(recipients).map(uid => ({
          user_id: uid,
          title: "Waitlist request",
          message: `${b.client_name!.trim()} is waiting for a spot on ${niceDate}`,
          type: "booking",
          is_read: false,
        }));
        const withEntity = base.map(r => ({ ...r, entity_type: "waitlist", entity_id: wl!.id }));
        const ins = await supabaseAdmin.from("notifications").insert(withEntity);
        if (ins.error && /entity_(type|id)/.test(ins.error.message)) {
          await supabaseAdmin.from("notifications").insert(base);
        }
      }
    } catch { /* notifications are best-effort */ }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
