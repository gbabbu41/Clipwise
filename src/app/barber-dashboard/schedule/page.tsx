"use client";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { ScheduleEditor } from "@/components/schedule-editor";

// Schedule = your working hours, breaks & lunch — the exact same editor the
// owner uses, scoped to you. Read-only when the owner hasn't granted
// "edit schedule" (ScheduleEditor renders a read-only view in that case).
export default function BarberSchedulePage() {
  const { accessToken } = useAuth();
  const { barber } = useBarber();
  const canEdit = barber?.permissions?.edit_schedule !== false;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-28">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Schedule</h1>
        <p className="text-sm text-[#777] mt-0.5">Your working hours, breaks &amp; lunch.</p>
      </div>
      {barber
        ? <ScheduleEditor key={barber.id} barberId={barber.id} barberName={barber.name ?? "you"} accessToken={accessToken} canEdit={canEdit} isOwner={false} />
        : <p className="text-sm text-[#777] py-12 text-center">Loading…</p>}
    </div>
  );
}
