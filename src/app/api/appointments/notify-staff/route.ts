import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { notifyNewBookingStaff } from "@/lib/notify-staff-server";

/**
 * HTTP wrapper for the new-booking staff alert (in-app notif + SMS to owner &
 * assigned barber). The real work lives in lib/notify-staff-server so booking
 * paths can call it DIRECTLY (server-side) instead of hopping through this route
 * — the old self-fetch could silently no-op when the request had no Origin
 * header, leaving in-person bookings with no owner alert. This endpoint remains
 * for any browser/external caller.
 *
 * Body: { appointment_id, notify_owner? }. Auth: none by design (called from the
 * anon booking page); rate-limited per-IP.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "notify-staff", 20, 60_000);
  if (limited) return limited;

  const { appointment_id, notify_owner = true } = await request.json().catch(() => ({})) as {
    appointment_id?: string; notify_owner?: boolean;
  };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  await notifyNewBookingStaff(appointment_id, { notifyOwner: notify_owner });
  return NextResponse.json({ ok: true });
}
