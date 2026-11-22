/** Minimum visible flat item count before unpaged `ObjectList` switches to windowed rendering. */
export const VIRTUAL_ROW_THRESHOLD = 60;

/** Number of extra items rendered above and below the visible viewport to prevent blank flashes while scrolling. */
export const VIRTUAL_OVERSCAN = 8;

/**
 * Safe viewport height fallback (px) when a scroll container has `clientHeight === 0` (for example in headless/jsdom
 * tests or before initial layout), guaranteeing that the first batch of rows still renders instead of an empty list.
 */
export const VIRTUAL_FALLBACK_VIEWPORT_HEIGHT = 480;

export interface VirtualWindow {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly topPadding: number;
  readonly bottomPadding: number;
  readonly totalHeight: number;
  readonly offsets: readonly number[];
}

export interface VirtualGridBand {
  readonly kind: "group" | "cards";
  readonly startItemIndex: number;
  readonly endItemIndex: number;
  readonly height: number;
}

/** Prefix sums of item heights: `offsets[i]` is the top of item `i`, `offsets[n]` is total scroll height. */
export function buildVirtualOffsets(heights: readonly number[]): {
  readonly offsets: readonly number[];
  readonly totalHeight: number;
} {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  let running = 0;
  for (let i = 0; i < heights.length; i += 1) {
    running += Math.max(1, heights[i] ?? 1);
    offsets[i + 1] = running;
  }
  return { offsets, totalHeight: running };
}

/** Binary search for the first index `i` with `offsets[i + 1] > target`. */
function findFirstVisibleIndex(offsets: readonly number[], count: number, target: number): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((offsets[mid + 1] ?? 0) <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Binary search for the first index `i` with `offsets[i] >= target` (exclusive upper bound). */
function findEndVisibleIndex(offsets: readonly number[], count: number, target: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((offsets[mid] ?? 0) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Compute the rendered `[startIndex, endIndex)` window and top/bottom spacer heights for a variable-height list.
 * When `viewportHeight <= 0` (e.g. jsdom), falls back to `VIRTUAL_FALLBACK_VIEWPORT_HEIGHT` so initial items render.
 */
export function computeVirtualWindow(
  heights: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number = VIRTUAL_OVERSCAN,
): VirtualWindow {
  const count = heights.length;
  if (count === 0) {
    return { startIndex: 0, endIndex: 0, topPadding: 0, bottomPadding: 0, totalHeight: 0, offsets: [0] };
  }
  const { offsets, totalHeight } = buildVirtualOffsets(heights);
  const effectiveViewport = viewportHeight > 0 ? viewportHeight : VIRTUAL_FALLBACK_VIEWPORT_HEIGHT;
  const maxScroll = Math.max(0, totalHeight - effectiveViewport);
  const clampedScroll = Math.max(0, Math.min(scrollTop, maxScroll));

  const firstVisible = findFirstVisibleIndex(offsets, count, clampedScroll);
  const lastVisibleExclusive = Math.max(
    firstVisible + 1,
    findEndVisibleIndex(offsets, count, clampedScroll + effectiveViewport),
  );

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(count, lastVisibleExclusive + overscan);
  const topPadding = offsets[startIndex] ?? 0;
  const bottomPadding = Math.max(0, totalHeight - (offsets[endIndex] ?? totalHeight));

  return {
    startIndex,
    endIndex,
    topPadding,
    bottomPadding,
    totalHeight,
    offsets,
  };
}

/**
 * Compute the scroll container `scrollTop` required to bring item `index` into the viewport (nearest-edge semantics).
 * Returns `currentScrollTop` unchanged when the item already fits inside the visible band.
 */
export function computeScrollTopForIndex(
  offsets: readonly number[],
  index: number,
  currentScrollTop: number,
  viewportHeight: number,
): number {
  if (index < 0 || index >= offsets.length - 1) return currentScrollTop;
  const itemTop = offsets[index] ?? 0;
  const itemBottom = offsets[index + 1] ?? itemTop;
  const effectiveViewport = viewportHeight > 0 ? viewportHeight : VIRTUAL_FALLBACK_VIEWPORT_HEIGHT;

  if (itemTop >= currentScrollTop && itemBottom <= currentScrollTop + effectiveViewport) {
    return currentScrollTop;
  }
  if (itemTop < currentScrollTop) return itemTop;
  return Math.max(0, itemBottom - effectiveViewport);
}

/**
 * Pack flat items (group headers + cards) into visual grid bands of `columnsPerRow` cards so virtualized card grids
 * keep column alignment steady across scrolls and let group headers span the full grid width.
 */
export function buildVirtualGridBands(
  kinds: readonly ("group" | "row")[],
  itemHeights: readonly number[],
  columnsPerRow: number,
): readonly VirtualGridBand[] {
  const cols = Math.max(1, Math.floor(columnsPerRow));
  const bands: VirtualGridBand[] = [];
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] === "group") {
      bands.push({ kind: "group", startItemIndex: i, endItemIndex: i + 1, height: itemHeights[i] ?? 32 });
      i += 1;
      continue;
    }
    const start = i;
    let maxHeight = 0;
    while (i < kinds.length && kinds[i] === "row" && i - start < cols) {
      maxHeight = Math.max(maxHeight, itemHeights[i] ?? 140);
      i += 1;
    }
    bands.push({ kind: "cards", startItemIndex: start, endItemIndex: i, height: maxHeight });
  }
  return bands;
}
