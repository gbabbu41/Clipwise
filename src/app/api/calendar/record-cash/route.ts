import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Ledger a CASH (or other in-person) completion so it appears in the barber
// Payments view, which reads only the transactions ledger. Card completions go
// through capture-appointment (which already writes a row) and online payments
// through markAppointmentPaid; this covers the cash/manual "Complete" path.
// Idempotent: never writes a second row for an appointment that already has one.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id } = await request.json() as { appointment_id?: string };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin.from("appointments")
    .select("id, shop_id, barber_id, service_id, client_name, total_amount, tax_amount, payment_status, payment_method")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only ledger a settled payment with a real amount (skip $0 / unpaid completes).
  const paid = appt.payment_status === "paid" || appt.payment_status === "captured";
  if (!paid || (appt.total_amount ?? 0) <= 0) return NextResponse.json({ ok: true, skipped: true });

  // Authorize: shop owner, or a barber of the shop.
  const { data: shop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", appt.shop_id).maybeSingle();
  let allowed = shop?.owner_id === user.id;
  if (!allowed) {
    const { data: b } = await supabaseAdmin.from("barbers").select("id").eq("shop_id", appt.shop_id).eq("user_id", user.id).maybeSingle();
    allowed = !!b;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Dedup: skip if this appointment already has a ledger row.
  const { data: existing } = await supabaseAdmin.from("transactions").select("id").eq("appointment_id", appointment_id).limit(1);
  if (existing && existing.length > 0) return NextResponse.json({ ok: true, deduped: true });

  const { data: svc } = appt.service_id
    ? await supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
    : { data: null as { name: string } | null };

  // Split tax out so `amount` is PRE-tax service revenue and `tax` is stored
  // separately — matching the card (capture-appointment) and POS ledger rows.
  // total_amount is GROSS (tax-inclusive), so pre-tax = total − tax. Without this
  // split, cash completions overstated pre-tax revenue and reported $0 tax
  // collected (corrupting the barber Payments view + the GST/tax report).
  const taxAmt = Math.max(0, Number(appt.tax_amount ?? 0));
  const row: Record<string, unknown> = {
    shop_id: appt.shop_id,
    barber_id: appt.barber_id || null,
    client_name: appt.client_name || null,
    service_name: svc?.name ?? "Service",
    amount: Math.max(0, (appt.total_amount ?? 0) - taxAmt),
    tip: 0,
    tax: taxAmt,
    payment_method: appt.payment_method || "cash",
    type: "service",
    appointment_id,
    source: "completion",
  };
  const { error: insErr } = await supabaseAdmin.from("transactions").insert(row);
  if (insErr) {
    // `tax` column may lag a migration — retry without it (keeping GROSS in
    // `amount` so no revenue is lost) rather than dropping the ledger row. Any
    // other error is surfaced in logs instead of being silently swallowed.
    if (/tax|column|schema cache/i.test(insErr.message)) {
      delete row.tax;
      row.amount = appt.total_amount ?? 0;
      const { error: e2 } = await supabaseAdmin.from("transactions").insert(row);
      if (e2) console.warn("[record-cash] ledger insert failed:", e2.message);
    } else {
      console.warn("[record-cash] ledger insert failed:", insErr.message);
    }
  }

  return NextResponse.json({ ok: true });
}
