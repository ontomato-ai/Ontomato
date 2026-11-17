import type { ChartMetricColumn } from "@ontomato/contracts/chart-data";

/** What `<metric-view-data>` hands to its default slot. */
export interface MetricViewDataSlots {
  default(props: {
    /** The MetricView's result as the data engine returns it; undefined until the first read finishes. */
    data: unknown;
    /** The columns this MetricView outputs, as the data engine declares them; empty until they arrive. */
    columns: ChartMetricColumn[];
    loading: boolean;
    /** Why the last read failed; null after a successful read. */
    error: Error | null;
    /** Reads again, e.g. after an Action changed the data. */
    reload: () => Promise<void>;
  }): unknown;
}
