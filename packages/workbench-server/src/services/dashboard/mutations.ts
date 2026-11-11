import { randomUUID } from "node:crypto";

import type { DashboardAddArtifact } from "@ontomato/contracts/dashboard-artifacts";
import { t } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { normalizeAbcProgram } from "./abc-program";
import {
  ensureDashboard,
  parseDashboardInput,
  findGroup,
  requireDashboardId,
  requireGroupId,
} from "./access";
import { resolveDashboardDatasets } from "./create-from-analysis";
import { planReferenceDashboard, changeMetricChartType } from "./reference-planning";
import { DashboardMetricClient } from "./metric-client";
import { isMetricReferenceEntry, metricReferenceChartSchema, metricReferenceMetricSchema } from "@ontomato/contracts/dashboard";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  saveDashboard,
} from "./store";
export async function createEmptyDashboard(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const name = String(body?.name || "").trim();
  if (!name) throw new HttpError(400, "name is required");
  const detail = await createDashboard({ ownerId, domainId, name, groups: [] });
  return { id: detail.id, name: detail.name };
}
export async function createDashboardDimension(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const id = requireDashboardId(body?.id);
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, id),
  );
  const groupTitle = String(body?.dimensionName || "").trim();
  if (!groupTitle) throw new HttpError(400, "dimensionName is required");
  detail.groups.push({
    id: randomUUID(),
    title: groupTitle,
    charts: [],
    metrics: [],
  });
  await saveDashboard(ownerId, domainId, detail);
}
export async function addDashboardChart(
  ownerId: string, domainId: string, body: DashboardAddArtifact, credentials: AssistantCredentials,
) {
  const { dashboardId, groupId, sessionId, datasetArtifactId } = body;
  const detail = ensureDashboard(ownerId, await getDashboard(ownerId, domainId, dashboardId));
  const group = findGroup(detail, groupId);
  const { datasets } = await resolveDashboardDatasets(sessionId, [datasetArtifactId], { userId: ownerId, domainId });
  const planned = await planReferenceDashboard(datasets, new DashboardMetricClient(domainId, credentials),
    detail.groups.flatMap(item => item.charts.map(chart => chart.chartType)));
  const charts = planned.groups.flatMap(item => item.charts);
  const metrics = planned.groups.flatMap(item => item.metrics);
  group.charts.push(...charts);
  group.metrics.push(...metrics);
  await saveDashboard(ownerId, domainId, detail);
  return { cardIds: [...charts, ...metrics].map(card => card.id) };
}

export async function renameDashboard(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const name = String(body?.name || "").trim();
  if (!name) throw new HttpError(400, "name is required");
  detail.name = name;
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardById(
  ownerId: string,
  domainId: string,
  body: any,
) {
  await deleteDashboard(ownerId, domainId, requireDashboardId(body?.id));
}
export async function renameDashboardDimension(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const group = findGroup(detail, requireGroupId(body?.groupId));
  group.title = String(body?.dimensionName || "").trim();
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardDimension(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const groupId = requireGroupId(body?.groupId);
  detail.groups = detail.groups.filter((group) => group.id !== groupId);
  await saveDashboard(ownerId, domainId, detail);
}
export async function renameDashboardChart(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const chartId = String(body?.chartId || "").trim();
  const name = String(body?.resultSetName || "").trim();
  for (const group of detail.groups) {
    const chart = group.charts.find((item) => item.id === chartId);
    if (chart) chart.name = name;
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardChart(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const chartId = String(body?.chartId || "").trim();
  for (const group of detail.groups) {
    group.charts = group.charts.filter((item) => item.id !== chartId);
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function changeDashboardChartType(
  ownerId: string, domainId: string, body: any, credentials: AssistantCredentials,
) {
  const detail = ensureDashboard(ownerId, await getDashboard(ownerId, domainId, requireDashboardId(body?.id)));
  const chartId = String(body?.chartId || "").trim();
  const chartType = String(body?.chartType || "").trim();
  for (const group of detail.groups) {
    const chart = group.charts.find(item => item.id === chartId);
    if (chart) {
      if (isMetricReferenceEntry(chart)) {
        Object.assign(chart, await changeMetricChartType(chart, chartType, new DashboardMetricClient(domainId, credentials)));
      } else {
        chart.chartType = chartType;
        chart.fields = undefined;
      }
    }
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function updateDashboardChartConditions(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const chartId = String(body?.chartId || "").trim();
  const conditions = Array.isArray(body?.conditions) ? body.conditions : [];
  for (const group of detail.groups) {
    const chart = group.charts.find((item) => item.id === chartId);
    if (chart) {
      if (isMetricReferenceEntry(chart))
        throw new HttpError(400, "Use the metric parameter form", "METRIC_PARAMETERS_REQUIRED");
      chart.conditions = conditions;
    }
  }
  await saveDashboard(ownerId, domainId, detail);
}
const chartPresentationPatch = metricReferenceChartSchema.omit({ id: true, query: true, source: true, chartType: true }).partial().strip();
const metricPresentationPatch = metricReferenceMetricSchema.omit({ id: true, query: true, source: true }).partial().strip();

export async function replaceDashboardLayout(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(ownerId, await getDashboard(ownerId, domainId, requireDashboardId(body?.id)));
  const savedCharts = new Map(detail.groups.flatMap(group => group.charts).map(card => [card.id, card]));
  const savedMetrics = new Map(detail.groups.flatMap(group => group.metrics).map(card => [card.id, card]));
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  detail.groups = groups.map((group: any) => ({
    id: String(group?.id || randomUUID()),
    title: String(group?.title || "").trim(),
    charts: (Array.isArray(group?.charts) ? group.charts : []).map((chart: any) => {
      const existing = savedCharts.get(chart.id);
      if (!existing) throw new HttpError(400, "Layout can only contain saved cards", "INVALID_REQUEST");
      if (isMetricReferenceEntry(existing)) {
        const requestedType = chart.chartType ?? chart.type;
        if (requestedType !== undefined && requestedType !== existing.chartType)
          throw new HttpError(400, "Change chart type through modifyResultSetChartType", "INVALID_REQUEST");
        return { ...existing, ...parseDashboardInput(chartPresentationPatch, chart) };
      }
      return {
        id: existing.id, name: String(chart?.name || "").trim(),
        chartType: String(chart?.type || chart?.chartType || "bar"),
        fields: chart?.fields || {}, dataPlan: chart?.dataPlan,
        conditions: Array.isArray(chart?.conditions) ? chart.conditions : [],
        abcProgram: normalizeAbcProgram(chart?.abcProgram) || existing.abcProgram,
        dsl: chart?.dsl || existing.dsl || {}, source: existing.source || {}, layout: chart?.layout,
      };
    }),
    metrics: (Array.isArray(group?.metrics) ? group.metrics : []).map((metric: any) => {
      const existing = savedMetrics.get(metric.id);
      if (!existing) throw new HttpError(400, "Layout can only contain saved cards", "INVALID_REQUEST");
      if (isMetricReferenceEntry(existing)) return { ...existing, ...parseDashboardInput(metricPresentationPatch, metric) };
      return {
        id: existing.id, name: String(metric?.name || "").trim(), unit: String(metric?.unit || "").trim(),
        agg: metric?.agg, valueField: metric?.valueField, dataPlan: metric?.dataPlan,
        abcProgram: normalizeAbcProgram(metric?.abcProgram) || existing.abcProgram,
        dsl: existing.dsl || {}, source: existing.source || {}, layout: metric?.layout,
      };
    }),
  }));
  await saveDashboard(ownerId, domainId, detail);
}
export async function renameDashboardMetric(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const metricId = String(body?.metricId || "").trim();
  const metricName = String(body?.metricName || "").trim();
  for (const group of detail.groups) {
    const metric = group.metrics.find((item) => item.id === metricId);
    if (metric) metric.name = metricName;
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardMetric(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const metricId = String(body?.metricId || "").trim();
  for (const group of detail.groups) {
    group.metrics = group.metrics.filter((item) => item.id !== metricId);
  }
  await saveDashboard(ownerId, domainId, detail);
}
