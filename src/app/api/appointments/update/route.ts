import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { barberHasConflict, isDoubleBookError } from "@/lib/booking-conflict";
import { timeToMinutes } from "@/lib/utils";

/**
 * Edit an appointment with an authoritative double-booking guard.
 *
 * Runs server-side (service role) so the overlap check sees ALL of the barber's
 * bookings regardless of the caller's RLS, and can never be skipped by the
 * client. Rejects an edit that would overlap another active appointment for the
 * same barber on the same day (excluding the appointment itself). The DB trigger
 * (phase18) is the final backstop; this gives an immediate, friendly 409 and
 * works even before that migration is run.
 *
 * Auth: shop owner OR an active barber of the shop.
 * Body: { appointment_id, fields: { client_name?, client_phone?, client_email?,
 *         date?, time_slot?, barber_id?, service_id?, total_amount?,
 *         duration_minutes?, notes? } }
 */
const EDITABLE = [
  "client_name", "client_phone", "client_email", "date", "time_slot",
  "barber_id", "service_id", "total_amount", "duration_minutes", "notes",
] as const;

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { appointment_id?: string; fields?: Record<string, unknown> };
  const { appointment_id, fields } = body;
  if (!appointment_id || !fields || typeof fields !== "object") {
    return NextResponse.json({ error: "Missing appointment_id or fields" }, { status: 400 });
  }

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, date, time_slot, duration_minutes, service_id, status")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  // Authorize: shop owner OR an active barber of this shop.
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id").eq("id", appt.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  let allowed = shop.owner_id === user.id;
  if (!allowed) {
    const { data: barberRow } = await supabaseAdmin
      .from("barbers").select("id").eq("shop_id", appt.shop_id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
    allowed = !!barberRow;
  }
  if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  // Resolve the would-be window.
  const newBarber = (fields.barber_id !== undefined ? fields.barber_id : appt.barber_id) as string | null;
  const newDate = (fields.date as string | undefined) ?? appt.date;
  const newSlot = (fields.time_slot as string | undefined) ?? appt.time_slot;
  let newDur = Number(fields.duration_minutes ?? 0);
  if (!newDur || newDur <= 0) {
    if (fields.service_id !== undefined && fields.service_id) {
      const { data: svc } = await supabaseAdmin.from("services").select("duration_minutes").eq("id", fields.service_id as string).maybeSingle();
      newDur = svc?.duration_minutes ?? 30;
    } else if (appt.duration_minutes && appt.duration_minutes > 0) {
      newDur = appt.duration_minutes;
    } else if (appt.service_id) {
      const { data: svc } = await supabaseAdmin.from("services").select("duration_minutes").eq("id", appt.service_id).maybeSingle();
      newDur = svc?.duration_minutes ?? 30;
    } else {
      newDur = 30;
    }
  }

  // Conflict guard — only for active bookings with a concrete barber + time.
  if (newBarber && newDate && newSlot && appt.status !== "cancelled" && appt.status !== "completed" && appt.status !== "no-show") {
    const startMin = timeToMinutes(newSlot);
    const endMin = startMin + (newDur > 0 ? newDur : 30);
    if (await barberHasConflict(newBarber, newDate, startMin, endMin, appointment_id)) {
      return NextResponse.json({ error: "That overlaps another booking for this barber — pick another time or shorten the service." }, { status: 409 });
    }
  }

  // Build the update from only the editable fields actually supplied.
  const update: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (k in fields) update[k] = fields[k] === "" ? null : fields[k];
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, noop: true });

  let { error } = await supabaseAdmin.from("appointments").update(update).eq("id", appointment_id);
  // duration_minutes may not exist yet (pre-phase14) — retry without it.
  if (error && /duration_minutes/.test(error.message) && "duration_minutes" in update) {
    delete update.duration_minutes;
    ({ error } = await supabaseAdmin.from("appointments").update(update).eq("id", appointment_id));
  }
  if (error) {
    if (isDoubleBookError(error)) {
      return NextResponse.json({ error: "That overlaps another booking for this barber — pick another time or shorten the service." }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't save the changes. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, applied: update });
}
