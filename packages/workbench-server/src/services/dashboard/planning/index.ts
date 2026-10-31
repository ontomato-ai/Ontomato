import {
  batchAppendChartFieldMapper,
  batchDashboardChartFieldMapper,
  recommendAppendDatasetPlan,
  recommendDashboardDatasetPlan,
} from "./core/chart-recommender";
import {
  applyDataPlan,
  buildDatasetProfile,
  isNumericLike,
  pickFirstNumericKey,
} from "./core/utils";
import type {
  DashboardPlanningInput,
  DashboardPlanningOutput,
  DatasetInput,
  DatasetProfile,
  PlannedDashboardGroup,
  PlannedDashboardMetricEntry,
} from "./types/index";

export { applyDataPlan };

export async function planDashboard(
  input: Partial<DashboardPlanningInput> & { datasets: DatasetInput[] },
): Promise<DashboardPlanningOutput> {
  const datasets = Array.isArray(input?.datasets) ? input.datasets : [];
  const profiles = datasets.map((ds) => buildDatasetProfile(ds));
  const existingChartTypes = Array.isArray(input?.existingChartTypes)
    ? input.existingChartTypes.map((x) => String(x)).filter(Boolean)
    : [];

  // Plan the structure, then map chart fields before finalizing metric specs.
  // A planning failure is reported to the caller: a dashboard created from an empty plan would
  // look successful while showing nothing the user asked for.
  let planned: DashboardPlanningOutput;
  if (input?.mode === "append") {
    const { charts = [], metrics = [] } = await recommendAppendDatasetPlan(profiles, existingChartTypes);
    const mapped = await batchAppendChartFieldMapper(charts, profiles);
    planned = { mode: "append", charts: mapped.charts ?? [], metrics };
  } else {
    const { name = "", groups = [] } = await recommendDashboardDatasetPlan(profiles);
    const mapped = await batchDashboardChartFieldMapper(groups, profiles);
    planned = { mode: "dashboard", name, groups: mapped.groups ?? [] };
  }

  const groups: PlannedDashboardGroup[] =
    planned.mode === "append"
      ? [{ title: "append", charts: planned.charts, metrics: planned.metrics }]
      : planned.groups || [];

  const profileIndex = new Map<string, DatasetProfile>();
  for (const p of profiles) profileIndex.set(p.datasetKey, p);

  const finalizeMetric = (m: PlannedDashboardMetricEntry): PlannedDashboardMetricEntry => {
    const prof = profileIndex.get(m.datasetKey);
    const baseRows = Array.isArray(prof?.sourceRows) ? prof.sourceRows : [];

    const plannedRows = applyDataPlan(baseRows, (m as any)?.dataPlan);
    const previewFields = plannedRows.length
      ? Object.keys(plannedRows[plannedRows.length - 1] || {})
      : [];
    const fields =
      previewFields.length > 0 ? previewFields : Array.isArray(prof?.fields) ? prof.fields : [];

    let agg = m.agg;
    let valueField = m.valueField;

    const valueFieldKey = typeof valueField === "string" ? valueField : "";
    const exists = valueFieldKey !== "" && fields.includes(valueFieldKey);

    const numericOK =
      agg === "count" ? true : exists ? isNumericLike(plannedRows, valueFieldKey) : false;

    if (!exists || !numericOK) {
      const k = pickFirstNumericKey(plannedRows);
      if (k) {
        valueField = k;
        if (agg === "count") agg = "sum";
      } else {
        agg = "count";
        valueField = "__count__";
      }
    }

    if (agg === m.agg && valueField === m.valueField) return m;
    return { ...m, agg, valueField };
  };

  const finalizedGroups: PlannedDashboardGroup[] = groups.map((g) => {
    const metrics = (g.metrics || []).map(finalizeMetric);
    return { ...g, metrics };
  });

  if (planned.mode === "append") {
    const g0 = finalizedGroups[0];
    return { mode: "append", charts: g0?.charts || [], metrics: g0?.metrics || [] };
  } else {
    return { mode: "dashboard", name: planned.name, groups: finalizedGroups };
  }
}
