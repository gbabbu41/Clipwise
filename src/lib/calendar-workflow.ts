export type CalendarAddContext = { shopId: string; date?: string; barberId?: string };

/** Synchronous, in-memory handoff from the visible calendar; never persisted. */
export function requestCalendarAddContext(shopId: string): CalendarAddContext {
  const detail: CalendarAddContext = { shopId };
  window.dispatchEvent(new CustomEvent("cw-calendar-add-context", { detail }));
  return detail;
}

export function calendarEditTotals(
  appointment: { service_id: string | null; duration_minutes?: number | null; total_amount?: number | null },
  selectedIds: string[],
  services: { id: string; duration_minutes: number | null; price: number | null }[],
  fallbackDuration: number,
) {
  const ids = selectedIds.filter(Boolean);
  const original = appointment.service_id ? [appointment.service_id] : [];
  const changed = ids.length !== original.length || ids.some((id, index) => id !== original[index]);
  return {
    changed,
    duration: changed
      ? ids.reduce((total, id) => total + (services.find(service => service.id === id)?.duration_minutes ?? 0), 0)
      : appointment.duration_minutes || fallbackDuration,
    price: changed
      ? ids.reduce((total, id) => total + Number(services.find(service => service.id === id)?.price ?? 0), 0)
      : Number(appointment.total_amount ?? 0),
  };
}
