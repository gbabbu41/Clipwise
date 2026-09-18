import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop, getBearer } from "@/lib/api-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { notifyWaitlistForSlot } from "@/lib/waitlist-notify-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Staff may manually notify a day or notify after freeing a slot. Customer
// cancellation/refund routes call the server-only sender after their own checks.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "waitlist-notify", 40, 60_000);
  if (limited) return limited;
  if (!getBearer(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    let shopId: string;
    let date: string;
    let barberId: string | null | undefined;
    if (body.appointment_id !== undefined) {
      if (typeof body.appointment_id !== "string" || !UUID_RE.test(body.appointment_id)) {
        return NextResponse.json({ error: "Invalid appointment" }, { status: 400 });
      }
      const { data: appt, error } = await supabaseAdmin.from("appointments")
        .select("shop_id, date, barber_id").eq("id", body.appointment_id).maybeSingle();
      if (error) return NextResponse.json({ error: "Couldn't load the appointment" }, { status: 503 });
      if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
      shopId = appt.shop_id;
      date = appt.date;
      barberId = appt.barber_id;
    } else {
      if (typeof body.shop_id !== "string" || !UUID_RE.test(body.shop_id)
        || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
        || !Number.isFinite(Date.parse(`${body.date}T12:00:00Z`))
        || new Date(`${body.date}T12:00:00Z`).toISOString().slice(0, 10) !== body.date
        || (body.barber_id != null && (typeof body.barber_id !== "string" || !UUID_RE.test(body.barber_id)))) {
        return NextResponse.json({ error: "Invalid shop, date or barber" }, { status: 400 });
      }
      shopId = body.shop_id;
      date = body.date;
      barberId = body.barber_id;
    }
    const auth = await authorizeShop(request, shopId, { permission: "manage_appointments" });
    if ("error" in auth) return auth.error;
    if (barberId) {
      const { data: barber, error } = await supabaseAdmin.from("barbers")
        .select("id").eq("id", barberId).eq("shop_id", shopId).maybeSingle();
      if (error) return NextResponse.json({ error: "Couldn't verify the barber" }, { status: 503 });
      if (!barber) return NextResponse.json({ error: "Barber not found in this shop" }, { status: 400 });
    }
    return NextResponse.json(await notifyWaitlistForSlot({ shop_id: shopId, date, barber_id: barberId }));
  } catch {
    return NextResponse.json({ error: "Couldn't notify the waitlist. Please try again." }, { status: 500 });
  }
}
