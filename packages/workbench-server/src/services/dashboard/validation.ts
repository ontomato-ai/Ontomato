import type { DashboardGroup } from "@ontomato/contracts/dashboard";
import { HttpError } from "../../utils/errors";
import type { DashboardMetricClient } from "./metric-client";

/** Describe enforces Java's current-user execution rule, including creator-owned candidates. */
export async function validatePersonalDashboardMetrics(groups: readonly DashboardGroup[], client: Pick<DashboardMetricClient, "describe">) {
  for (const group of groups) for (const card of [...group.charts, ...group.metrics]) {
    const metric = await client.describe(card.query.metricId);
    const parameters = new Set(metric.parameterDefs.map(parameter => String(parameter.name)));
    if (Object.keys(card.query.parameters).some(name => !parameters.has(name)))
      throw new HttpError(400, "Unknown capability parameter", "INVALID_PRODUCT_PARAMETER");
  }
}
