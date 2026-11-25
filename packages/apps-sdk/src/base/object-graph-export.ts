/** Pure helpers for graph PNG export filenames and visual-only pending connection previews. */

/** Synthetic edge ID reserved for an uncommitted visual connection preview in visual modeling. */
export const PENDING_GRAPH_EDGE_ID = "__sdk_pending_connect_edge__";

/** Uncommitted visual-only edge drawn while the reader completes a new-relation dialog. */
export interface PendingGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
}

/** Formats a local calendar date as `YYYY-MM-DD`. */
export function formatLocalDateStamp(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolves a graph PNG export filename from an optional template (replacing `{date}` with the local `YYYY-MM-DD`
 * date) or falls back to the projection name, ensuring a `.png` extension.
 */
export function resolveGraphExportFilename(
  template: string | undefined,
  fallbackName: string,
  now: Date = new Date(),
): string {
  const raw = template?.trim();
  const base = raw ? raw.replace(/\{date\}/g, formatLocalDateStamp(now)) : fallbackName;
  return /\.png$/i.test(base) ? base : `${base}.png`;
}
