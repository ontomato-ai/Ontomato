/** One readable source chip shown by `SegmentedTextReader`. */
export interface SegmentedTextSource {
  readonly id: string;
  readonly title: string;
}

/** One plain-text segment returned for an offset slice. */
export interface TextSegmentItem {
  readonly id: string;
  readonly text: string;
}

/** One offset-paged slice of a source's text, with an optional `nextOffset` when more segments follow. */
export interface SegmentedTextPage {
  readonly sourceId: string;
  readonly title: string;
  readonly items: readonly TextSegmentItem[];
  readonly nextOffset?: number | null;
  readonly emptyHint?: string;
}
