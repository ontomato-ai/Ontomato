import { dashboardSourceSchema } from "@ontomato/contracts/dashboard-artifacts";
import { assistantService } from "../assistant/service";
import { assistantStore, type AssistantOwner } from "../assistant/store";
import { projectDataset } from "../assistant/dataset-projection";
import type {
  DashboardChartEntry,
  DashboardGroup,
  DashboardMetricEntry,
} from "@ontomato/contracts/dashboard";
import { randomUUID } from "node:crypto";

import { config } from "../../config/application";
import { backendPost } from "../../utils/backend-client";
import { t, tApp } from "../../i18n";
import { HttpError } from "../../utils/errors";
import {
  normalizeAbcProgram,
  normalizeAbcProgramParametersForUi,
} from "./abc-program";
import {
  ABC_PROGRAM_DASHBOARD_TIMEOUT_MS,
  wrapDashboardBackendError,
} from "./dsl-execution";
import { planDashboard } from "./planning/index";
import { createDashboard } from "./store";
import type { DashboardDatasetInput } from "./types";
export async function resolveDashboardDatasets(
  sessionId: string,
  artifactIds: string[],
  owner: AssistantOwner,
): Promise<{ datasets: DashboardDatasetInput[] }> {
  const datasets: DashboardDatasetInput[] = [];
  await assistantStore.session(sessionId, owner);
  for (const id of [...new Set(artifactIds)]) {
    const { payload, source } = await assistantService.dataset(
      sessionId,
      id,
      owner,
    );
    const artifact = await assistantService.artifact(sessionId, id, owner);
    const dataset = projectDataset(id, payload, {
      retrievalId: source.retrievalId,
      runtimeSessionId: artifact.sessionId,
      runtimeRunId: artifact.runId,
    });
    datasets.push({
      datasetKey: id,
      subQuestion: payload.question,
      data: payload.rows,
      dsl: payload.recipe.kind === "dsl" ? payload.recipe.dsl : {},
      abcProgram: dataset.abcProgram,
      source: { sessionId, artifactId: id },
      ...(payload.truncation ?? {}),
    });
  }
  return { datasets };
}
export async function createDashboardFromAnalysis(
  ownerId: string,
  domainId: string,
  body: any,
  tk: string,
  locale: string,
) {
  const { sessionId, datasetArtifactIds } = dashboardSourceSchema.parse(body);
  const { datasets } = await resolveDashboardDatasets(
    sessionId,
    datasetArtifactIds,
    { userId: ownerId, domainId },
  );
  if (!datasets.length)
    throw new HttpError(400, t("api.noAvailableDashboardData"));
  const needParameter = body?.needParameter === true;

  const groupsFromReq = Array.isArray(body?.groups) ? body.groups : [];
  let groups: DashboardGroup[];
  let plannedName = "";
  if (groupsFromReq.length) {
    groups = groupsFromReq;
  } else if (needParameter && datasets.some((dataset) => dataset.abcProgram)) {
    // Only an explicit parameterized-dashboard request needs the ABC dashboard maker.
    // Planning otherwise keeps the dataset's real fields instead of an empty default chart.
    const charts: DashboardChartEntry[] = [];

    for (const dataset of datasets) {
      if (!dataset.abcProgram) continue;
      const backendUrl = config.dataQuery.baseUrl;
      if (!backendUrl) {
        throw new Error(
          t("api.executionFailed", {
            status: 500,
            detail: t("api.backendNotConfigured"),
          }),
        );
      }
      const endpoint = "/dashboard/createFromABCProgram";
      let payload: any;
      try {
        const response = await backendPost(
          endpoint,
          `${backendUrl.replace(/\/$/, "")}${endpoint}`,
          {
            question: dataset.subQuestion || dataset.abcProgram.title,
            code: dataset.abcProgram.code,
            outKeyRefs: dataset.abcProgram.outKeyRefs,
            needParameter,
          },
          { token: tk, timeoutMs: ABC_PROGRAM_DASHBOARD_TIMEOUT_MS, locale },
        );
        payload = (response.headers.get("content-type") || "").includes(
          "application/json",
        )
          ? JSON.parse(response.text)
          : response.text;
      } catch (error) {
        throw wrapDashboardBackendError(error, "api.executionFailed");
      }

      const program = normalizeAbcProgram(payload?.data) || dataset.abcProgram;
      const title =
        program.title || dataset.subQuestion || tApp("queryFixed.149");
      const parameters = normalizeAbcProgramParametersForUi(program.parameters);
      charts.push({
        id: randomUUID(),
        name: title,
        chartType: "bar",
        fields: {},
        dataPlan: { mode: "raw" },
        dsl: {},
        abcProgram: { ...program, parameters },
        conditions: parameters,
        source: {
          ...dataset.source,
          datasetKey: dataset.datasetKey,
          subQuestion: dataset.subQuestion,
        },
        layout: { colSpan: 12, rowSpan: 1 },
      });
      if (!plannedName && program.title) plannedName = program.title;
    }

    if (!charts.length)
      throw new HttpError(400, t("api.noAvailableDashboardData"));
    groups = [
      {
        id: randomUUID(),
        title: plannedName || "ABC Program",
        charts,
        metrics: [],
      },
    ];
  } else {
    const planned = await planDashboard({ mode: "dashboard", datasets });
    plannedName = String((planned as any)?.name || "").trim();
    // A DSL stays the executable source when the dataset has one; the frozen program is
    // the fallback for metric and Python recipes, which have no DSL of their own.
    const sourceOf = (datasetKey: string) => {
      const source = datasets.find((item) => item.datasetKey === datasetKey);
      const dsl = source?.dsl || {};
      return {
        source,
        dsl,
        abcProgram:
          Object.keys(dsl).length === 0 ? source?.abcProgram : undefined,
      };
    };
    groups = (planned as any)?.groups?.map((group: any) => {
      const charts = (Array.isArray(group?.charts) ? group.charts : [])
        .filter((chart: any) => {
          const source = datasets.find(
            (item) => item.datasetKey === chart.datasetKey,
          );
          if (!source) return false;
          const rows = Array.isArray(source.data) ? source.data : [];
          if (rows.length <= 1) return false;
          if (rows.length > 0 && Object.keys(rows[0]).length <= 1) return false;
          return true;
        })
        .map((chart: any) => {
          const { source, dsl, abcProgram } = sourceOf(chart.datasetKey);
          return {
            id: randomUUID(),
            name: String(chart?.name || ""),
            chartType: String(chart?.type || "bar"),
            fields: chart?.fields || {},
            dataPlan: chart?.dataPlan,
            dsl,
            ...(abcProgram ? { abcProgram } : {}),
            source: {
              ...source?.source,
              datasetKey: source?.datasetKey,
              subQuestion: source?.subQuestion,
            },
            layout: { colSpan: 12, rowSpan: 1 },
          } satisfies DashboardChartEntry;
        });

      const metrics = (Array.isArray(group?.metrics) ? group.metrics : []).map(
        (metric: any) => {
          const { source, dsl, abcProgram } = sourceOf(metric.datasetKey);
          return {
            id: randomUUID(),
            name: String(metric?.name || ""),
            unit: String(metric?.unit || ""),
            agg: metric?.agg,
            valueField: metric?.valueField,
            dataPlan: metric?.dataPlan,
            dsl,
            ...(abcProgram ? { abcProgram } : {}),
            source: {
              ...source?.source,
              datasetKey: source?.datasetKey,
              subQuestion: source?.subQuestion,
            },
            layout: { colSpan: 6, rowSpan: 1 },
          } satisfies DashboardMetricEntry;
        },
      );

      return {
        id: randomUUID(),
        title: String(group?.title || tApp("queryFixed.150")),
        charts,
        metrics,
      };
    });
  }

  const detail = await createDashboard({
    ownerId,
    domainId,
    id: String(body?.id || randomUUID()),
    name:
      String(body?.name || "").trim() ||
      plannedName ||
      tApp("queryFixed.148", { v0: new Date().toISOString().slice(0, 10) }),
    source: { sessionId },
    groups,
  });
  return { id: detail.id, name: detail.name };
}
