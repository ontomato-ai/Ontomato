import type { ObjectListColumn } from "./object-list-types";

/**
 * Filter table columns against the measured list container width using each column's optional
 * `minContainerWidth` threshold.
 *
 * - When `containerWidth <= 0` (unmeasured or headless layout), all columns stay visible.
 * - When `containerWidth > 0`, columns whose `minContainerWidth > containerWidth` are hidden.
 * - Guarantees at least one column remains visible whenever `columns` is non-empty by falling
 *   back to the column with the lowest `minContainerWidth` (breaking ties by earliest order).
 */
export function filterResponsiveColumns(
  columns: readonly ObjectListColumn[],
  containerWidth: number,
): readonly ObjectListColumn[] {
  if (columns.length === 0 || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return columns;
  }

  const allowed = columns.filter(
    (column) => column.minContainerWidth === undefined || containerWidth >= column.minContainerWidth,
  );
  if (allowed.length > 0) return allowed;

  let fallback = columns[0]!;
  let lowestThreshold = fallback.minContainerWidth ?? 0;
  for (let index = 1; index < columns.length; index += 1) {
    const candidate = columns[index]!;
    const threshold = candidate.minContainerWidth ?? 0;
    if (threshold < lowestThreshold) {
      fallback = candidate;
      lowestThreshold = threshold;
    }
  }
  return [fallback];
}
