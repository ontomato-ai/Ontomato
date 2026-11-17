import type { DashboardAddChartFile } from "./dashboard-artifacts";
import type { DashboardMetricReference, DashboardMetricDescription, MetricReferenceChartEntry } from "./dashboard";

export type ChartImportRequest = DashboardAddChartFile["source"];
export type ChartImportResponse = {
  file:MetricReferenceChartEntry["chartFile"];
  query:DashboardMetricReference;
  metric:Pick<DashboardMetricDescription,"name"|"status"|"revision">;
  source:ChartImportRequest;
};
