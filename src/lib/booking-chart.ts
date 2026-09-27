import { shiftYmd } from "@/lib/timezone";

/** Calendar buckets, including quiet days; never substitute 'active days'. */
export function bookingChartDays(appointments: { date: string }[], start: string, end: string) {
  if (!start || !end || start > end) return [];
  const counts = new Map<string, number>();
  for (const a of appointments) counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
  const rows: { date: string; day: string; count: number }[] = [];
  for (let date = start; date <= end; date = shiftYmd(date, 1)) {
    rows.push({ date, day: new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }), count: counts.get(date) ?? 0 });
  }
  return rows;
}

/** Keep long-period charts readable without discarding any days or bookings. */
export function bookingChartSeries(days: ReturnType<typeof bookingChartDays>) {
  if (days.length <= 45) return days.map(d => ({ ...d, endDate: d.date }));
  const months = new Map<string, { date: string; endDate: string; day: string; count: number }>();
  const spansYears = days[0].date.slice(0, 4) !== days[days.length - 1].date.slice(0, 4);
  for (const d of days) {
    const key = d.date.slice(0, 7);
    const bucket = months.get(key);
    if (bucket) { bucket.count += d.count; bucket.endDate = d.date; }
    else months.set(key, {
      date: d.date, endDate: d.date, count: d.count,
      day: new Date(`${d.date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", ...(spansYears ? { year: "numeric" } : {}) }),
    });
  }
  return Array.from(months.values());
}

export function bookingReportRange(start: string, end: string): string {
  const label = (date: string, year: boolean) => new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}),
  });
  return start === end ? label(end, true) : `${label(start, start.slice(0, 4) !== end.slice(0, 4))} – ${label(end, true)}`;
}
