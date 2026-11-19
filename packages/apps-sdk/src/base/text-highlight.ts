import type { TextHighlightRange } from "../panel/platform-objects";

/** One contiguous slice of a plain text string, marked when it falls within an adapter-supplied highlight range. */
export interface TextSegment {
  readonly text: string;
  readonly hit: boolean;
}

/**
 * Splits a plain text string by half-open `[start, end)` highlight ranges into non-overlapping segments.
 * Components interpolate `segment.text` as text nodes so owner/query highlights never inject raw HTML.
 */
export function textHighlightSegments(
  text: string,
  ranges?: readonly TextHighlightRange[],
): readonly TextSegment[] {
  if (!text || !ranges?.length) return [{ text, hit: false }];
  const normalized = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(text.length, Math.trunc(range.start))),
      end: Math.max(0, Math.min(text.length, Math.trunc(range.end))),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  if (!normalized.length) return [{ text, hit: false }];

  const merged: { start: number; end: number }[] = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), hit: false });
    segments.push({ text: text.slice(range.start, range.end), hit: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}
