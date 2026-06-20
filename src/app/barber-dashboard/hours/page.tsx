"use client";

import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { ScheduleEditor } from "@/components/schedule-editor";
import { DEFAULT_BARBER_PERMISSIONS } from "@/lib/database.types";

export default function BarberHoursPage() {
  const { accessToken } = useAuth();
  const { barber } = useBarber();
  const canEdit = (barber?.permissions ?? DEFAULT_BARBER_PERMISSIONS).edit_schedule !== false;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-28">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">My Hours</h1>
        <p className="text-sm text-[#777] mt-0.5">Set your working hours, breaks &amp; lunch. You&apos;ll get it emailed to you.</p>
      </div>
      {!canEdit && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
          <Lock size={14} /> Your shop owner controls your hours — this view is read-only.
        </div>
      )}
      {barber
        ? <ScheduleEditor key={barber.id} barberId={barber.id} barberName={barber.name ?? "you"} accessToken={accessToken} canEdit={canEdit} isOwner={false} />
        : <p className="text-sm text-[#777] py-12 text-center">Loading…</p>}
    </div>
  );
}
