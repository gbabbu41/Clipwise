const BARBER_TINTS = ["93, 143, 194", "74, 151, 143", "190, 145, 77", "151, 126, 184"] as const;

export type CalendarStatusTone = "confirmed" | "completed" | "pending" | "cancelled" | "no-show" | "neutral";

export function calendarStatusTone(status?: string | null): CalendarStatusTone {
  switch (status) {
    case "confirmed": return "confirmed";
    case "completed": return "completed";
    case "pending": return "pending";
    case "cancelled": return "cancelled";
    case "no-show": return "no-show";
    default: return "neutral";
  }
}

/** Stable roster assignment keeps the first four barbers distinct regardless of query order. */
export function calendarBarberTint(id?: string | null, roster: readonly string[] = []): string {
  if (!id) return "126, 132, 140";
  const index = roster.filter((value, i) => roster.indexOf(value) === i).sort().indexOf(id);
  if (index >= 0) return BARBER_TINTS[index % BARBER_TINTS.length];
  if (roster.length > 0) return "126, 132, 140";
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return BARBER_TINTS[(hash >>> 0) % BARBER_TINTS.length];
}
