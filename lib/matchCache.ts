// In-memory cache of match rows already loaded by the matches list, keyed by id.
//
// Why: the detail screen (useMatch) otherwise shows a full-screen spinner while
// it fetches a match the list ALREADY has in memory. Seeding the detail from
// this cache lets it paint instantly and revalidate in the background, so
// "entering" a match feels immediate. Measured: detail data is ~300ms, but the
// spinner makes it feel slow — this removes the wait when coming from the list.
//
// Module-level (not React state) on purpose: it must survive navigation between
// the list and the detail route without a provider.

const byId = new Map<string, any>();

/** Store/refresh the rows loaded by the list so the detail can seed from them. */
export const cacheMatchList = (matches: any[] | null | undefined) => {
  if (!matches) return;
  for (const m of matches) {
    if (m && m.id != null) byId.set(String(m.id), m);
  }
};

/** Returns the cached row for an id, or null. Shape is the list row (a superset
 *  of the fields the detail header needs); detail-only columns (image_url,
 *  cancellation_hours, …) fill in once the background fetch resolves. */
export const getCachedMatch = (id: string | null | undefined): any | null =>
  id != null ? byId.get(String(id)) ?? null : null;
