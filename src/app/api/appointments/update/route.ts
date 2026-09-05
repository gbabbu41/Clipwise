import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { barberHasConflict, isDoubleBookError } from "@/lib/booking-conflict";
import { scheduleBlockReason } from "@/lib/schedule-block";
import { authorizeAppointment } from "@/lib/api-auth";
import { timeToMinutes, prettyDate, formatCurrency } from "@/lib/utils";
import { sendAppEmail } from "@/lib/emailer";
import { insertNotifications } from "@/lib/notify-server";
import { sendSmsBestEffort } from "@/lib/twilio";
import { effectivePlan, isPaidPlan, clampLen, FIELD_CAPS } from "@/lib/validation";
import { taxOnAmount, type TaxConfig } from "@/lib/pricing";

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
  const body = await request.json() as { appointment_id?: string; fields?: Record<string, unknown>; override_block?: boolean };
  const { appointment_id, fields } = body;
  if (!appointment_id || !fields || typeof fields !== "object") {
    return NextResponse.json({ error: "Missing appointment_id or fields" }, { status: 400 });
  }

  // Authorize: shop owner OR a barber with manage_appointments — the SAME gate as
  // capture-appointment / payment-link. This route can change total_amount (which
  // feeds a later saved-card charge at completion) and reassign / move the booking,
  // so a barber whose manage_appointments is OFF must not be able to reach it.
  const auth = await authorizeAppointment(request, appointment_id, { permission: "manage_appointments" });
  if ("error" in auth) return auth.error;
  const appt = auth.appointment as {
    id: string; shop_id: string; barber_id: string | null; date: string;
    time_slot: string; duration_minutes: number | null; service_id: string | null; status: string;
  };

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

  // Only conflict-check when the actual time window moves (barber / day / start /
  // duration). A name-or-payment-only edit can't introduce an overlap, and
  // shouldn't be blocked by a pre-existing one. We don't guard a freed row
  // (cancelled / no-show), but a completed one still holds its slot.
  const curDur = appt.duration_minutes && appt.duration_minutes > 0 ? appt.duration_minutes : null;
  const windowChanged =
    newBarber !== appt.barber_id ||
    newDate !== appt.date ||
    newSlot !== appt.time_slot ||
    (("duration_minutes" in fields || fields.service_id !== undefined) && newDur !== curDur);
  const freed = appt.status === "cancelled" || appt.status === "no-show";
  if (windowChanged && !freed && newBarber && newDate && newSlot) {
    const startMin = timeToMinutes(newSlot);
    const endMin = startMin + (newDur > 0 ? newDur : 30);
    if (await barberHasConflict(newBarber, newDate, startMin, endMin, appointment_id)) {
      return NextResponse.json({ error: "That overlaps another booking for this barber — pick another time or shorten the service." }, { status: 409 });
    }
    // Moving onto a DELIBERATE block — approved time-off (day_off/vacation/sick),
    // blocked-hours, or a recurring break (lunch) — is allowed but warned. The
    // client shows a confirm and retries with override_block. `blocked: true`
    // marks this 409 as an OVERRIDABLE schedule conflict (vs the hard double-book
    // conflict above). This route is already staff-only (owner / barber with
    // manage_appointments), so the flag can't reach it from a customer.
    if (!body.override_block) {
      const blockReason = await scheduleBlockReason(
        appt.shop_id, newBarber, newDate, startMin, endMin, { includeBreaks: true },
      );
      if (blockReason) {
        return NextResponse.json({ error: blockReason, blocked: true }, { status: 409 });
      }
    }
  }

  // Build the update from only the editable fields actually supplied. Clamp the
  // free-text fields to the DB caps so an oversized value truncates instead of
  // tripping the CHECK constraint (mirrors the public booking inserts).
  const TEXT_CAPS: Record<string, number> = {
    client_name: FIELD_CAPS.client_name,
    client_email: FIELD_CAPS.client_email,
    client_phone: FIELD_CAPS.client_phone,
    notes: FIELD_CAPS.notes,
  };
  const update: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (k in fields) {
      const raw = fields[k] === "" ? null : fields[k];
      update[k] = (typeof raw === "string" && k in TEXT_CAPS) ? clampLen(raw, TEXT_CAPS[k]) : raw;
    }
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, noop: true });

  // ── Price change → recompute tax on the SERVER + keep the stored total honest.
  // The client sends total_amount as the PRE-TAX subtotal of the picked services
  // (it's the only side that knows a multi-service combo). Never trust a
  // client-computed tax/total: mirror the booking convention here — the one place
  // tax is trusted — so an edited price can't store a pre-tax total with a stale
  // tax (the $55 total / $5.25 tax bug). Stamp total_amount = subtotal + tax and
  // tax_amount = tax, from THIS shop's config (tax is a paid-plan feature).
  let priceWarning: string | null = null;
  if ("total_amount" in update) {
    const subtotal = Math.max(0, Number(update.total_amount) || 0);
    const shopRow = auth.shop as { booking_settings?: TaxConfig | null; subscription_plan?: string | null; subscription_status?: string | null };
    const plan = effectivePlan(shopRow.subscription_plan ?? undefined, shopRow.subscription_status ?? undefined);
    const taxCfg = isPaidPlan(plan) ? (shopRow.booking_settings ?? null) : null;
    const tax = taxOnAmount(subtotal, taxCfg);
    update.total_amount = Math.round((subtotal + tax) * 100) / 100;
    update.tax_amount = tax;

    // Guardrail — a raise the card on file can't absorb. A HELD authorization can
    // only be captured up to what it authorized, and a charge already SETTLED
    // can't be topped up. If staff raise the price on one of those, the extra
    // won't be auto-collected at checkout — warn so nobody thinks they charged the
    // new price. A saved card (charged fresh off-session at completion) and an
    // unpaid/cash booking can still collect the full new total, so they're fine.
    const a = auth.appointment as {
      total_amount?: number | null; payment_status?: string | null; balance_due?: number | null;
    };
    const oldTotal = Number(a.total_amount ?? 0);
    const oldBalance = Math.max(0, Number(a.balance_due ?? 0));
    const newTotal = Number(update.total_amount);
    const status = a.payment_status ?? null;
    const heldHold = status === "held";
    const alreadyPaid = status === "paid" || status === "captured";

    // Editing the price of an ALREADY-SETTLED appointment: the money already
    // collected is (oldTotal − oldBalance). Whatever the new total exceeds that by
    // becomes the uncollected balance — so reports count only what came in and the
    // shortfall surfaces in Checkout → Unpaid. Without this, a portal price bump on
    // a captured appointment left balance_due null, so the full new total counted
    // as collected → inflated tax/commission → negative net.
    if (alreadyPaid) {
      const collectedSoFar = Math.max(0, oldTotal - oldBalance);
      update.balance_due = Math.max(0, Math.round((newTotal - collectedSoFar) * 100) / 100);
    }

    if (newTotal > oldTotal + 0.005 && (heldHold || alreadyPaid)) {
      const extra = (newTotal - oldTotal).toFixed(2);
      priceWarning = alreadyPaid
        ? `This appointment was already paid ($${(oldTotal - oldBalance).toFixed(2)}). The extra $${extra} won't be charged automatically — collect it in Checkout · Unpaid (charge / cash / link).`
        : `Only about $${oldTotal.toFixed(2)} is authorized on the card on file. The extra $${extra} can't be auto-charged at checkout — collect it in person or send a payment link.`;
    }
  }

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

  // ── Tell the customer + affected barbers when the booking actually moved or
  // was reassigned ───────────────────────────────────────────────────────────
  // A name/notes/price-only edit doesn't notify the customer. When the time or
  // barber changes, the customer gets an "updated" email (with the manage link,
  // which is the live source of truth), the newly-assigned barber gets a
  // heads-up, and the barber it moved away from is told it left their column.
  // Awaited (best-effort, never fails the save) so the email reliably sends
  // before this serverless function returns.
  const barberChanged = "barber_id" in update && (update.barber_id ?? null) !== (appt.barber_id ?? null);
  const dateChanged = "date" in update && update.date !== appt.date;
  const timeChanged = "time_slot" in update && update.time_slot !== appt.time_slot;
  if (barberChanged || dateChanged || timeChanged) {
    try {
      const { data: full } = await supabaseAdmin
        .from("appointments")
        .select("client_name, client_email, client_phone, date, time_slot, total_amount, barber_id, service_id, shop_id")
        .eq("id", appointment_id).maybeSingle();
      if (full) {
        const [{ data: shopRow }, { data: svc }] = await Promise.all([
          supabaseAdmin.from("shops").select("name, owner_id, subscription_plan, subscription_status").eq("id", full.shop_id).maybeSingle(),
          full.service_id
            ? supabaseAdmin.from("services").select("name").eq("id", full.service_id).maybeSingle()
            : Promise.resolve({ data: null as { name: string } | null }),
        ]);
        const [{ data: newBarber }, { data: oldBarber }] = await Promise.all([
          full.barber_id
            ? supabaseAdmin.from("barbers").select("name, user_id, email").eq("id", full.barber_id).maybeSingle()
            : Promise.resolve({ data: null as { name: string; user_id: string | null; email: string | null } | null }),
          barberChanged && appt.barber_id
            ? supabaseAdmin.from("barbers").select("name, user_id").eq("id", appt.barber_id).maybeSingle()
            : Promise.resolve({ data: null as { name: string; user_id: string | null } | null }),
        ]);

        const prettyWhen = `${prettyDate(full.date)} at ${full.time_slot}`;
        const oldWhen = `${prettyDate(appt.date)} at ${appt.time_slot}`;   // the previous time
        const timeMoved = dateChanged || timeChanged;
        const changes: string[] = [];
        if (timeMoved) changes.push(`new time — ${prettyWhen}`);
        if (barberChanged) changes.push(`barber — ${newBarber?.name ?? "Any Available"}`);
        const changedSummary = changes.join("; ");

        // 1) Customer — the "your appointment was updated" email that was missing.
        if (full.client_email) {
          await sendAppEmail("appointment_updated", {
            clientEmail: full.client_email,
            clientName: full.client_name ?? "there",
            shopName: shopRow?.name ?? "",
            barberName: newBarber?.name ?? "Any Available",
            serviceName: svc?.name ?? "Service",
            date: prettyDate(full.date),
            time: full.time_slot ?? "",
            total: full.total_amount ? formatCurrency(full.total_amount) : "",
            appointmentId: appointment_id,
            changedSummary,
            // Old → new time (only when the time actually moved) so the email
            // leads with a clear "Previous vs New" instead of just the new time.
            fromWhen: timeMoved ? oldWhen : "",
            toWhen: timeMoved ? prettyWhen : "",
          }).catch(() => null);
        }

        // 1b) Customer SMS — the reschedule text. An "important" event (their
        // appointment moved), so it's one of the few that get an SMS. Kept to a
        // single GSM-7 segment (no em dash / curly quotes; shop name is added by
        // sendSmsBestEffort, not duplicated in the body) and awaited so a
        // serverless freeze can't drop it.
        if (full.client_phone && isPaidPlan(effectivePlan(shopRow?.subscription_plan, shopRow?.subscription_status))) {
          const base = process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
          const smsBody = timeMoved
            ? `Your appointment was moved to ${prettyDate(full.date)} at ${full.time_slot} (was ${oldWhen}). Manage: ${base}/my-booking/${appointment_id}`
            : `Your appointment details were updated. Manage: ${base}/my-booking/${appointment_id}`;
          await sendSmsBestEffort(full.client_phone, smsBody, shopRow?.name);
        }

        // 2) Newly-assigned barber — in-app alert + email so they see the new job.
        if (barberChanged && newBarber?.user_id) {
          await insertNotifications({
            user_id: newBarber.user_id, shop_id: full.shop_id, type: "booking",
            title: "Appointment assigned to you",
            message: `${full.client_name ?? "A client"} — ${prettyWhen}`,
          });
          if (newBarber.email) {
            await sendAppEmail("new_booking_barber", {
              barberEmail: newBarber.email,
              barberName: newBarber.name ?? "there",
              shopName: shopRow?.name ?? "",
              clientName: full.client_name ?? "A client",
              clientPhone: "",
              serviceName: svc?.name ?? "Service",
              date: prettyDate(full.date),
              time: full.time_slot ?? "",
              total: full.total_amount ? formatCurrency(full.total_amount) : "",
            }).catch(() => null);
          }
        }

        // 3) Barber it moved away from — told it left their column.
        if (barberChanged && oldBarber?.user_id) {
          await insertNotifications({
            user_id: oldBarber.user_id, shop_id: full.shop_id, type: "booking",
            title: "Appointment reassigned",
            message: `${full.client_name ?? "A client"}'s appointment (${prettyWhen}) was moved to another barber.`,
          });
        }

        // 4) Same barber, only the time/day moved → tell that barber their
        // appointment shifted. Previously ONLY a reassignment notified a barber,
        // so a pure time change never reached them (in-app or email).
        if (!barberChanged && (dateChanged || timeChanged) && newBarber?.user_id) {
          await insertNotifications({
            user_id: newBarber.user_id, shop_id: full.shop_id, type: "booking",
            title: "Appointment rescheduled",
            message: `${full.client_name ?? "A client"}: ${oldWhen} → ${prettyWhen}`,
          });
          if (newBarber.email) {
            await sendAppEmail("barber_appointment_change", {
              barberEmail: newBarber.email,
              barberName: newBarber.name ?? "there",
              shopName: shopRow?.name ?? "",
              shopEmail: "",
              clientName: full.client_name ?? "A client",
              serviceName: svc?.name ?? "Service",
              date: full.date,
              time: full.time_slot ?? "",
              statusLabel: "Rescheduled",
              fromWhen: oldWhen,
              toWhen: prettyWhen,
            }).catch(() => null);
          }
        }

        // 5) Owner heads-up — unless the owner is the one who made the change
        //    (no point notifying yourself). Covers "a barber rescheduled a
        //    client" so the owner always knows a booking moved.
        if (!auth.isOwner && shopRow?.owner_id) {
          await insertNotifications({
            user_id: shopRow.owner_id, shop_id: full.shop_id, type: "booking",
            title: timeMoved ? "Appointment rescheduled" : "Appointment reassigned",
            message: timeMoved
              ? `${full.client_name ?? "A client"}: ${oldWhen} → ${prettyWhen}${barberChanged ? ` · ${newBarber?.name ?? "Any Available"}` : ""}`
              : `${full.client_name ?? "A client"} moved to ${newBarber?.name ?? "Any Available"}`,
          });
        }
      }
    } catch { /* notifications are best-effort — the save already succeeded */ }
  }

  return NextResponse.json({ ok: true, applied: update, warning: priceWarning ?? undefined });
}
