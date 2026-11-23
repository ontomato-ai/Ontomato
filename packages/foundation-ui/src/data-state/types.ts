/**
 * What one named datum of a member is, as the platform and the instance show it: its value once the owner answered with
 * one, the owner's empty answer, a reason it could not be read, no permission, still on its way, or not asked for yet
 * because a selection it needs is missing. Only `ready` carries a value; every other state has one presentation for the
 * whole product.
 */
export type DataStateResult<T = unknown> =
  | { status: "ready"; value: T }
  /**
   * `narrowed`: the reader narrowed the read (a search, a filter), so nothing matched rather than nothing is there.
   * `clearFilters`: when provided on a narrowed empty state, renders a button to clear search and filters.
   * `emptyHint`: optional secondary hint line shown beneath the empty message (e.g. pointing to header create).
   */
  | { status: "empty"; narrowed?: true; clearFilters?: () => void; emptyHint?: string }
  /** `retry`, when given, reads the datum again (a read the platform never answered, say). */
  | { status: "error"; message: string; retry?: () => void }
  /** `reason`: optional owner-supplied explanation of why access was refused; falls back to `labels.forbidden`. */
  | { status: "forbidden"; reason?: string }
  | { status: "loading" }
  | { status: "awaiting" };

/** The words of the states the owner does not word itself, in the reader's language, from the caller's messages. */
export interface DataStateLabels {
  empty: string;
  /** Optional secondary hint shown beneath the empty message when no data exists yet. */
  emptyHint?: string;
  /** A read the reader narrowed found nothing: say nothing matches, so they widen it. */
  noMatch: string;
  /** The button that clears search and filters when a narrowed read matched nothing. */
  clearFilters?: string;
  forbidden: string;
  /** A selection the datum needs is missing: say what to do, not that nothing was found. */
  awaiting: string;
  /** The button that reads a failed datum again. */
  retry: string;
}
