import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";
import { sendAppEmail } from "@/lib/emailer";

/**
 * Fire-and-forget: a booked slot just freed (cancel / reject / no-show), so
 * notify the customers waiting for that day. Matches the smart-waitlist rows
 * on shop + date where the waiter wanted EITHER any barber OR the barber who
 * just freed up, then emails + texts them a booking link and marks them
 * "notified" so they aren't pinged twice.
 *
 * Body: either { appointment_id } (resolved server-side) OR { shop_id, date, barber_id? }.
 * Auth: none — only ever called server-to-server (best-effort) from the app's
 * own cancellation handlers. It reveals nothing and writes only notify status.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      appointment_id?: string;
      shop_id?: string; date?: string; barber_id?: string | null;
    };

    let shop_id = body.shop_id;
    let date = body.date;
    let barber_id = body.barber_id;

    // Preferred path: resolve everything from the freed appointment row.
    if (body.appointment_id) {
      const { data: appt } = await supabaseAdmin
        .from("appointments")
        .select("shop_id, date, barber_id")
        .eq("id", body.appointment_id)
        .maybeSingle();
      if (appt) { shop_id = appt.shop_id; date = appt.date; barber_id = appt.barber_id; }
    }

    if (!shop_id || !date) return NextResponse.json({ error: "Missing shop_id or date" }, { status: 400 });

    let q = supabaseAdmin
      .from("appointment_waitlist")
      .select("*")
      .eq("shop_id", shop_id)
      .eq("desired_date", date)
      .eq("status", "waiting");
    // Only notify waiters who'll actually be served by the freed barber:
    // those who asked for "any" barber (null) or for this specific one.
    if (barber_id) q = q.or(`barber_id.is.null,barber_id.eq.${barber_id}`);
    const { data: waiters } = await q;

    if (!waiters || waiters.length === 0) return NextResponse.json({ notified: 0 });

    const { data: shop } = await supabaseAdmin
      .from("shops").select("name, slug, email").eq("id", shop_id).maybeSingle();
    if (!shop) return NextResponse.json({ notified: 0 });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      || request.headers.get("origin")
      || "http://localhost:3000";
    const bookingUrl = `${baseUrl}/book/${shop.slug}`;
    const niceDate = new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", {
      weekday: "long", month: "short", day: "numeric",
    });

    // Look up barber names once for the email.
    const barberNames: Record<string, string> = {};
    const ids = Array.from(new Set(waiters.map(w => w.barber_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: bs } = await supabaseAdmin.from("barbers").select("id, name").in("id", ids);
      (bs ?? []).forEach(x => { barberNames[x.id] = x.name; });
    }

    await Promise.all(waiters.map(async (w) => {
      const barberName = w.barber_id ? (barberNames[w.barber_id] ?? "") : "";
      if (w.client_email) {
        // Send in-process (no HTTP hop, no shared secret) so waitlist alerts
        // never silently fail when CRON_SECRET isn't set.
        await sendAppEmail("waitlist_slot_open", {
          clientName: w.client_name,
          clientEmail: w.client_email,
          shopName: shop.name,
          shopEmail: shop.email ?? "",
          date: niceDate,
          barberName,
          bookingUrl,
        }).catch(() => null);
      }
      await sendSmsBestEffort(
        w.client_phone,
        `A spot just opened on ${niceDate}${barberName ? ` with ${barberName}` : ""}. Book now: ${bookingUrl}`,
        shop.name,
      );
    }));

    // Mark them notified so a second cancellation that day doesn't re-spam.
    const ids2 = waiters.map(w => w.id);
    await supabaseAdmin
      .from("appointment_waitlist")
      .update({ status: "notified", notified_at: new Date().toISOString() })
      .in("id", ids2);

    return NextResponse.json({ notified: waiters.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
