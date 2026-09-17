import { shiftYmd } from "@/lib/timezone";

/** Calendar buckets, including quiet days; never substitute 'active days'. */
export function bookingChartDays(appointments: { date: string }[], start: string, end: string) {
  if (!start || !end || start > end) return [];
  const first = [start, shiftYmd(end, -13)].sort().at(-1)!;
  const counts = new Map<string, number>();
  for (const a of appointments) counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
  const rows: { date: string; day: string; count: number }[] = [];
  for (let date = first; date <= end; date = shiftYmd(date, 1)) {
    rows.push({ date, day: new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }), count: counts.get(date) ?? 0 });
  }
  return rows;
}
