/** Calendar buckets in the viewer's local timezone; labels include the year. */
export function earningsBuckets<T extends { created_at: string }>(
  rows: T[], from: number, to: number, monthly: boolean, value: (row: T) => number,
) {
  const valid = rows.filter(row => Number.isFinite(new Date(row.created_at).getTime()));
  const end = Number.isFinite(to) ? to : Date.now();
  const start = from > 0 ? from : valid.reduce((earliest, row) => Math.min(earliest, new Date(row.created_at).getTime()), end);
  if (start > end) return [];
  const floor = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); if (monthly) d.setDate(1); return d; };
  const buckets = new Map<number, { label: string; val: number }>();
  for (const d = floor(start); d.getTime() <= end; monthly ? d.setMonth(d.getMonth() + 1) : d.setDate(d.getDate() + 1)) {
    buckets.set(d.getTime(), { label: d.toLocaleDateString("en-CA", { year: "numeric", month: "short", ...(monthly ? {} : { day: "numeric" }) }), val: 0 });
  }
  for (const row of valid) {
    const ms = new Date(row.created_at).getTime();
    if (ms < start || ms > end) continue;
    const bucket = buckets.get(floor(ms).getTime());
    if (bucket) bucket.val += value(row);
  }
  return Array.from(buckets.values());
}
