// PostgREST caps an unpaginated select() at 1000 rows with no error — a
// table that's grown past that (nss_responses already has, and will keep
// growing) silently drops rows rather than failing loudly, corrupting any
// aggregate computed from an incomplete set. Pages through with .range()
// until a page comes back short of the page size.
export async function fetchAllRows<T>(
  pageFrom: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await pageFrom(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
