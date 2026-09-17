type PageResult<T> = { data: T[] | null; error: unknown };

/** Never silently treat a PostgREST row cap or failed page as a complete ledger.
 * The caller must order by a stable unique key (or timestamp + unique id).
 */
export async function readAllRows<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  // Below the usual server row cap. Continue until an EMPTY page, so even a
  // project configured with a smaller cap doesn't truncate results.
  const pageSize = 500;
  for (let from = 0; from < 100000;) {
    const result = await page(from, from + pageSize - 1);
    if (result.error || !result.data) throw new Error("Could not load complete records. Please retry.");
    if (!result.data.length) return rows;
    rows.push(...result.data);
    from += result.data.length;
  }
  throw new Error("This report is too large to load completely. Choose a shorter period.");
}
