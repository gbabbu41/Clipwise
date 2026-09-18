import "server-only";
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
 * Server-only: callers must authorize staff or validate the customer mutation
 * before invoking. Browser callers go through the protected slot-opened route.
 */
export async function notifyWaitlistForSlot({ shop_id, date, barber_id }: {
  shop_id: string; date: string; barber_id?: string | null;
}): Promise<{ notified: number }> {

    let q = supabaseAdmin
      .from("appointment_waitlist")
      .select("*")
      .eq("shop_id", shop_id)
      .eq("desired_date", date)
      .eq("status", "waiting");
    // Only notify waiters who'll actually be served by the freed barber:
    // those who asked for "any" barber (null) or for this specific one.
    // Only ever interpolate a well-formed UUID (never raw body text) into the
    // PostgREST filter — filter-injection guard. Never broaden an invalid ID.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (barber_id && !UUID_RE.test(barber_id)) throw new Error("Invalid barber");
    if (barber_id) q = q.or(`barber_id.is.null,barber_id.eq.${barber_id}`);
    const { data: waiters, error: waitersError } = await q;
    if (waitersError) throw new Error("Waitlist unavailable");

    if (!waiters || waiters.length === 0) return { notified: 0 };

    const { data: shop, error: shopError } = await supabaseAdmin
      .from("shops").select("name, slug, email").eq("id", shop_id).maybeSingle();
    if (shopError) throw new Error("Shop unavailable");
    if (!shop) return { notified: 0 };

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      || "https://clipwise.ca";
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

    return { notified: waiters.length };
}
