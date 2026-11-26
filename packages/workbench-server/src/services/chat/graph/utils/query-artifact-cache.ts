import { tApp } from "../../../../i18n";
import type { QueryExecutionFact } from "../../../data-query/query-fact";
import type { AnalysisResult, GraphState, QueryArtifactRef, VisualizationResult } from "../state";
import {
  buildQueryRunId,
  getQueryRunBySource,
  STANDARD_QUERY_SOURCE_KIND,
  STANDARD_QUERY_SOURCE_REF,
  type QueryRun,
} from "../../../data-query/query-run-store";
import { createLogger } from "../../../../logging/logger";
import type { ResultTruncation } from "@ontomato/contracts/query-execution";
import type { FieldDisplayPlan } from "../../../data-query/adapter";

const logger = createLogger("query-artifact-cache");

export interface ResolvedAnalysisDataset {
  title?: string;
  data: Record<string, unknown>[];
  fieldDisplayPlan?: FieldDisplayPlan;
  truncation?: ResultTruncation;
}

export interface ResolvedAnalysisData {
  datasets: ResolvedAnalysisDataset[];
  source: "current_query" | "historical";
  queryResult?: QueryExecutionFact;
}

export function createQueryArtifactRef(input: {
  threadId: string;
  requestSeq: number;
  sourceKind?: string;
  sourceRef?: string;
  queryRunId?: string;
}): QueryArtifactRef {
  const sourceKind = input.sourceKind || STANDARD_QUERY_SOURCE_KIND;
  const sourceRef = input.sourceRef || STANDARD_QUERY_SOURCE_REF;
  return {
    queryRunId: input.queryRunId || buildQueryRunId(input.threadId, input.requestSeq, sourceRef),
    threadId: input.threadId,
    requestSeq: input.requestSeq,
    sourceKind,
    sourceRef,
  };
}

export function createRuntimeArtifactRef(
  kind: "analysis" | "visualization",
  threadId: string,
  requestSeq: number
): string {
  return `${kind}:${threadId}:${requestSeq}`;
}

function queryArtifactKey(ref: QueryArtifactRef): string {
  return `${ref.threadId}:${ref.requestSeq}:${ref.sourceKind}:${ref.sourceRef}`;
}

function rowsFromDataset(dataset: any): Record<string, unknown>[] | undefined {
  return Array.isArray(dataset?.data) ? (dataset.data as Record<string, unknown>[]) : undefined;
}

function datasetTitle(dataset: any): string | undefined {
  for (const candidate of [dataset?.subQuestion, dataset?.description, dataset?.name]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function fieldDisplayPlanFromDataset(dataset: any): FieldDisplayPlan | undefined {
  const plan = dataset?.fieldDisplayPlan;
  return plan && typeof plan === "object" && !Array.isArray(plan)
    ? (plan as FieldDisplayPlan)
    : undefined;
}

function truncationFromDataset(dataset: any): ResultTruncation | undefined {
  return dataset?.truncated
    ? { truncated: true, rowLimit: dataset.rowLimit, truncationHint: dataset.truncationHint }
    : undefined;
}

function normalizeDatasets(raw: unknown): ResolvedAnalysisDataset[] {
  if (!Array.isArray(raw)) return [];
  const datasets: ResolvedAnalysisDataset[] = [];
  for (const item of raw) {
    const rows = rowsFromDataset(item);
    if (!rows) continue;
    datasets.push({
      title: datasetTitle(item),
      data: rows,
      fieldDisplayPlan: fieldDisplayPlanFromDataset(item),
      truncation: truncationFromDataset(item),
    });
  }
  return datasets;
}

function hasUsableDatasets(datasets: readonly ResolvedAnalysisDataset[]): boolean {
  return datasets.some((dataset) => dataset.data.length > 0 || !!dataset.truncation);
}

export class QueryArtifactCache {
  private readonly queryResults = new Map<string, QueryExecutionFact>();
  private readonly analysisResults = new Map<string, AnalysisResult>();
  private readonly visualizationResults = new Map<string, VisualizationResult>();

  setQueryResult(ref: QueryArtifactRef, queryResult: QueryExecutionFact): void {
    this.queryResults.set(queryArtifactKey(ref), queryResult);
  }

  getQueryResult(ref: QueryArtifactRef | undefined): QueryExecutionFact | undefined {
    return ref ? this.queryResults.get(queryArtifactKey(ref)) : undefined;
  }

  setAnalysisResult(ref: string, analysisResult: AnalysisResult): void {
    this.analysisResults.set(ref, analysisResult);
  }

  getAnalysisResult(ref: string | undefined): AnalysisResult | undefined {
    return ref ? this.analysisResults.get(ref) : undefined;
  }

  setVisualizationResult(ref: string, visualizationResult: VisualizationResult): void {
    this.visualizationResults.set(ref, visualizationResult);
  }

  getVisualizationResult(ref: string | undefined): VisualizationResult | undefined {
    return ref ? this.visualizationResults.get(ref) : undefined;
  }
}

export function getQueryArtifactCache(config?: any): QueryArtifactCache | undefined {
  return config?.configurable?.queryArtifactCache;
}

export function hasUsableDataReference(state: GraphState): boolean {
  return Boolean(
    state.queryArtifactRef ||
    state.historicalQueryRef ||
    (Array.isArray(state.mockData) && state.mockData.length > 0)
  );
}

export async function resolveCurrentQueryResult(
  state: GraphState,
  config?: any
): Promise<QueryExecutionFact | undefined> {
  if (!state.queryArtifactRef) {
    return undefined;
  }
  const queryResult = getQueryArtifactCache(config)?.getQueryResult(state.queryArtifactRef);
  if (!queryResult) {
    logger.warn(tApp("queryFixed.116"), {
      threadId: state.queryArtifactRef.threadId,
      requestSeq: state.queryArtifactRef.requestSeq,
      sourceKind: state.queryArtifactRef.sourceKind,
      sourceRef: state.queryArtifactRef.sourceRef,
    });
  }
  return queryResult;
}

function datasetsFromQueryRun(queryRun?: QueryRun | null): ResolvedAnalysisDataset[] {
  const raw = Array.isArray(queryRun?.datasetsPayload)
    ? queryRun.datasetsPayload
    : Array.isArray(queryRun?.dataPayload)
      ? queryRun.dataPayload
      : [];
  return normalizeDatasets(raw);
}

/** A completed run is usable when any dataset has rows or a partial-result marker: zero rows there are not "no data". */
export function hasUsableQueryRun(queryRun?: QueryRun | null): boolean {
  return queryRun?.status === "completed" && hasUsableDatasets(datasetsFromQueryRun(queryRun));
}

export async function resolveAnalysisData(
  state: GraphState,
  config?: any
): Promise<ResolvedAnalysisData | undefined> {
  const currentQueryResult = await resolveCurrentQueryResult(state, config);
  const currentDatasets = normalizeDatasets(currentQueryResult?.datasets);
  if (currentDatasets.length > 0) {
    return {
      datasets: currentDatasets,
      source: "current_query",
      queryResult: currentQueryResult,
    };
  }

  if (state.historicalQueryRef) {
    try {
      const queryRun = await getQueryRunBySource(state.historicalQueryRef);
      const historicalDatasets = datasetsFromQueryRun(queryRun);
      if (hasUsableDatasets(historicalDatasets)) {
        return {
          datasets: historicalDatasets,
          source: "historical",
        };
      }
    } catch (error) {
      logger.error(tApp("queryFixed.117"), {
        threadId: state.historicalQueryRef.threadId,
        requestSeq: state.historicalQueryRef.requestSeq,
        sourceKind: state.historicalQueryRef.sourceKind,
        sourceRef: state.historicalQueryRef.sourceRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return undefined;
}

export function resolveRuntimeAnalysisResult(
  state: GraphState,
  config?: any
): AnalysisResult | undefined {
  return getQueryArtifactCache(config)?.getAnalysisResult(state.analysisArtifactRef);
}

export function resolveRuntimeVisualizationResult(
  state: GraphState,
  config?: any
): VisualizationResult | undefined {
  return getQueryArtifactCache(config)?.getVisualizationResult(state.visualizationArtifactRef);
}
