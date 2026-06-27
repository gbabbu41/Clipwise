"use client";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { CalendarView } from "@/components/calendar-view";

// The exact same full-page calendar the owner has (Apple-style Year⇄Month⇄Day,
// day rail, swipe), isolated to this barber. Read-only unless the owner granted
// "manage appointments" (owners-who-cut get full rights).
export default function BarberCalendarPage() {
  const { profile } = useAuth();
  const { barber } = useBarber();
  const canManage = profile?.role === "shop_owner" || barber?.permissions?.manage_appointments === true;
  const canBlock = profile?.role === "shop_owner" || barber?.permissions?.block_hours !== false;
  if (!barber) {
    return <div className="h-[70vh] flex items-center justify-center text-[#777] text-sm">Loading calendar…</div>;
  }
  return <CalendarView defaultView="day" forceBarberId={barber.id} canManage={canManage} canBlock={canBlock} />;
}
