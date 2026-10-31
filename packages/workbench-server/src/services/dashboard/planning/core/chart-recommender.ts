import { runAuxiliary } from "../../../../platform/agent-runtime/runtime";
import type {
  DatasetProfile,
  FieldMappingRequest,
  PlannedDashboardChartEntry,
  PlannedDashboardGroup,
} from "../types/index";
import {
  buildAppendPlannerSystemPrompt,
  buildChartFieldPlannerSystemPrompt,
  buildChartFieldPlannerUserPrompt,
  buildDashboardPlannerSystemPrompt,
} from "./prompts";
import { applyDataPlan, getChartFieldContract } from "./utils";
import { buildModelDataView } from "../../../../utils/model-data-view";
import { workbenchProduct } from "../../../../product/installed";

export function cleanJsonBlock(text: string) {
  return String(text ?? "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function stripParenContent(text: string) {
  return String(text ?? "")
    .replace(workbenchProduct().chartFieldAnnotationPattern, "")
    .trim();
}

function normalizeObjectKeysDeep(input: any): any {
  if (Array.isArray(input)) return input.map(normalizeObjectKeysDeep);
  if (!input || typeof input !== "object") return input;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    out[stripParenContent(key)] = normalizeObjectKeysDeep(value);
  }
  return out;
}

function buildRequest(
  profileIndex: Map<string, DatasetProfile>,
  id: string,
  ch: any,
): FieldMappingRequest {
  const prof = profileIndex.get(String(ch?.datasetKey || ""));
  const baseRows = Array.isArray(prof?.sourceRows) ? prof.sourceRows : [];
  const plannedRows = applyDataPlan(baseRows, ch?.dataPlan);
  const allFields = Array.from(
    new Set(plannedRows.flatMap((row) => Object.keys(row || {}))),
  );
  const chartType = String(ch?.type || "metric");
  return {
    id,
    chartType,
    contract: getChartFieldContract(chartType),
    subQuestion: String(ch?.name || ""),
    dataView: buildModelDataView(plannedRows),
    allFields,
  };
}

async function planChartFields(
  requests: FieldMappingRequest[],
): Promise<Map<string, Record<string, any>>> {
  const systemPrompt = buildChartFieldPlannerSystemPrompt();
  const mappings = new Map<string, Record<string, any>>();
  for (const req of requests) {
    const userPrompt = buildChartFieldPlannerUserPrompt(req);
    const raw = (
      await runAuxiliary({ systemPrompt, message: userPrompt })
    ).trim();
    // A chart whose fields cannot be planned is an empty chart; the caller reports the plan failed
    // rather than creating a dashboard the user cannot read.
    mappings.set(
      req.id,
      normalizeObjectKeysDeep(JSON.parse(cleanJsonBlock(raw))),
    );
  }
  return mappings;
}

export async function recommendAppendDatasetPlan(
  profiles: DatasetProfile[],
  existingChartTypes: string[],
) {
  if (!profiles || profiles.length === 0) {
    return { metrics: [], charts: [] };
  }

  const systemPrompt = buildAppendPlannerSystemPrompt();
  const userPrompt = JSON.stringify({
    existingChartTypes: existingChartTypes ?? [],
    datasets: profiles.map(
      ({ sourceRows: _sourceRows, ...profile }) => profile,
    ),
  });

  const raw = (
    await runAuxiliary({ systemPrompt, message: userPrompt })
  ).trim();
  const parsed = JSON.parse(cleanJsonBlock(raw));
  return {
    charts: Array.isArray(parsed?.charts) ? parsed.charts : [],
    metrics: Array.isArray(parsed?.metrics) ? parsed.metrics : [],
  };
}

export async function recommendDashboardDatasetPlan(
  profiles: DatasetProfile[],
) {
  if (!profiles || profiles.length === 0) {
    return { name: "", groups: [] };
  }

  const systemPrompt = buildDashboardPlannerSystemPrompt();
  const userPrompt = JSON.stringify({
    datasets: profiles.map((p) => ({
      datasetKey: p.datasetKey,
      subQuestion: p.subQuestion,
      rowCount: p.rowCount,
      fields: p.fields,
      dataView: p.dataView,
      dataType: p.dataType,
    })),
  });

  const raw = (
    await runAuxiliary({ systemPrompt, message: userPrompt })
  ).trim();
  const parsed = JSON.parse(cleanJsonBlock(raw));
  return {
    name: typeof parsed?.name === "string" ? parsed.name.trim() : "",
    groups: Array.isArray(parsed?.groups) ? parsed.groups : [],
  };
}

export async function batchAppendChartFieldMapper(
  charts: PlannedDashboardChartEntry[],
  profiles: DatasetProfile[],
) {
  const profileIndex = new Map<string, DatasetProfile>();
  for (const p of profiles) profileIndex.set(p.datasetKey, p);
  const requests: FieldMappingRequest[] = charts.map((ch: any, ci: number) =>
    buildRequest(profileIndex, String(ci), ch),
  );
  const mappings = await planChartFields(requests);
  const mappedCharts: PlannedDashboardChartEntry[] = charts.map(
    (ch: any, ci: number) => ({
      ...ch,
      fields: mappings.get(String(ci)) ?? {},
    }),
  );
  return { mode: "append", charts: mappedCharts, profiles };
}

export async function batchDashboardChartFieldMapper(
  groups: PlannedDashboardGroup[],
  profiles: DatasetProfile[],
) {
  const profileIndex = new Map<string, DatasetProfile>();
  for (const p of profiles) profileIndex.set(p.datasetKey, p);
  const requests: FieldMappingRequest[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const charts = Array.isArray(g?.charts) ? g.charts : [];
    for (let ci = 0; ci < charts.length; ci++) {
      requests.push(buildRequest(profileIndex, `${gi}:${ci}`, charts[ci]));
    }
  }
  const mappings = await planChartFields(requests);

  const outGroups: PlannedDashboardGroup[] = groups.map((g, gi) => {
    const chartsIn = Array.isArray(g?.charts) ? g.charts : [];
    const charts: PlannedDashboardChartEntry[] = chartsIn.map(
      (ch: any, ci: number) => ({
        ...ch,
        fields: mappings.get(`${gi}:${ci}`) ?? {},
      }),
    );
    return { title: g.title, charts, metrics: g.metrics };
  });
  return { mode: "dashboard", name: "", groups: outGroups, profiles };
}
