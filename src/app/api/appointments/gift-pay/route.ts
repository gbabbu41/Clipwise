import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeAppointment } from "@/lib/api-auth";
import { logGiftFailure } from "@/lib/gift-redeem";

// Checkout → "Gift card": pay an appointment with a gift card code. The browser
// only sends the code; what's owed, what the card covers and the leftover come
// from the database in ONE locked step (phase71 gift_pay_appointment), linked to
// the booking so cancelling it later gives the value back. Completion (status +
// side effects) stays with the caller's normal completion path, like cash.

const MESSAGES: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: "Appointment not found." },
  not_open: { status: 409, error: "This appointment is cancelled or a no-show — it can't be paid." },
  already_paid: { status: 409, error: "This appointment is already paid." },
  card_held: { status: 409, error: "A card is being held for this booking — charge it (Complete + Capture) instead." },
  nothing_due: { status: 409, error: "Nothing is owed on this appointment." },
  card_not_found: { status: 404, error: "No gift card with that code." },
  card_empty: { status: 409, error: "That gift card is used up or voided." },
};

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({})) as { appointment_id?: string; code?: string };
  const auth = await authorizeAppointment(request, b.appointment_id, { permission: "manage_appointments" });
  if ("error" in auth) return auth.error;
  const code = typeof b.code === "string" ? b.code.trim().toUpperCase().replace(/\s+/g, "") : "";
  if (!code) return NextResponse.json({ error: "Enter the gift card code." }, { status: 400 });
  const appt = auth.appointment;

  const { data, error } = await supabaseAdmin.rpc("gift_pay_appointment", {
    p_shop_id: appt.shop_id, p_appointment_id: appt.id, p_code: code,
  });
  if (error) {
    await logGiftFailure("appointments/gift-pay", { shopId: appt.shop_id, appointmentId: appt.id }, error);
    return NextResponse.json({ error: "Couldn't use the gift card — nothing was charged. Please try again." }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { applied: number | string; balance_due: number | string | null; card_balance: number | string | null; status: string } | null;
  if (!row || row.status !== "ok") {
    const m = MESSAGES[row?.status ?? ""] ?? { status: 500, error: "Couldn't use the gift card." };
    return NextResponse.json({ error: m.error }, { status: m.status });
  }
  return NextResponse.json({
    ok: true,
    applied: Number(row.applied),
    balance_due: Number(row.balance_due ?? 0),
    card_balance: row.card_balance == null ? null : Number(row.card_balance),
  });
}
