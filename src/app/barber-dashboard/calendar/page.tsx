"use client";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { CalendarView } from "@/components/calendar-view";

// The exact same calendar the owner has, isolated to this barber. Read-only
// unless the owner granted "manage appointments" (owners-who-cut get full rights).
export default function BarberCalendarPage() {
  const { profile } = useAuth();
  const { barber } = useBarber();
  const canManage = profile?.role === "shop_owner" || barber?.permissions?.manage_appointments === true;
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-white uppercase tracking-wide mb-3">Calendar</h1>
      <div className="h-[calc(100dvh-11rem)] min-h-[480px] rounded-2xl overflow-hidden border border-[#1e1e1e]">
        {barber
          ? <CalendarView embedded canManage={canManage} forceBarberId={barber.id} />
          : <div className="h-full flex items-center justify-center text-[#777] text-sm">Loading calendar…</div>}
      </div>
    </div>
  );
}
