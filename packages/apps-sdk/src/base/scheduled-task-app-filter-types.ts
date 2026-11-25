import type { PanelGroupCounts } from "@ontomato/contracts/panel-projection";

/** An owner-counted application, or the total when its key is the empty string. */
export type ScheduledTaskAppFilterItem = Readonly<PanelGroupCounts[number]>;
