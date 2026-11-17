/** What `<metric-view-data>` hands to its default slot. */
export interface MetricViewDataSlots {
  default(props: {
    /** The MetricView's result as the data engine returns it; undefined until the first read finishes. */
    data: unknown;
    loading: boolean;
    /** Why the last read failed; null after a successful read. */
    error: Error | null;
    /** Reads again, e.g. after an Action changed the data. */
    reload: () => Promise<void>;
  }): unknown;
}
