import type { DashboardLayout } from "./dashboard";

/** Persisted inline cards remain readable until the release conversion. */
export type TransformSpec =
  | {
      kind: "groupBy";
      groupBy: string[];
      metrics: Array<{ op: "count" | "sum" | "avg"; field?: string; as: string }>;
      sortBy?: { field: string; order: "asc" | "desc" };
      limit?: number;
      otherLabel?: string;
    }
  | {
      kind: "pivot";
      index: string;
      columns: string;
      value: { op: "count" | "sum"; field?: string; as: string };
      topIndex?: number;
      otherLabel?: string;
    };

export type DataPlan =
  | { mode: "raw" }
  | {
      mode: "derived";
      title?: string;
      transform: TransformSpec;
    };

export type LegacyDashboardChartEntry = {
  query?: never;
  id: string;
  name: string;
  chartType: string;
  dsl: Record<string, unknown>;
  abcProgram?: AbcProgramDashboard;
  fields?: Record<string, unknown>;
  dataPlan?: DataPlan;
  conditions?: unknown[];
  layout?: DashboardLayout;
  source?: {
    sessionId?: string;
    artifactId?: string;
    threadId?: string;
    requestSeq?: number;
    datasetIndex?: number;
    datasetKey?: string;
    subQuestion?: string;
  };
};

export type LegacyDashboardMetricEntry = {
  query?: never;
  id: string;
  name: string;
  unit?: string;
  dsl: Record<string, unknown>;
  abcProgram?: AbcProgramDashboard;
  dataPlan?: DataPlan;
  agg?: "count" | "sum" | "avg";
  valueField?: string;
  layout?: DashboardLayout;
  source?: {
    sessionId?: string;
    artifactId?: string;
    threadId?: string;
    requestSeq?: number;
    datasetIndex?: number;
    datasetKey?: string;
    subQuestion?: string;
  };
};

export type AbcProgramOutKeyRef = {
  key: string;
  className?: string;
  attrName?: string;
  asGroupBy?: boolean;
  statCal?: boolean;
};

export type AbcProgramParameter = {
  key: string;
  name?: string;
  type?: string;
  value?: unknown;
  className?: string;
  attrName?: string;
};

export type AbcProgramDashboard = {
  title: string;
  code: string;
  queryPackage?: import("./query-package").QueryPackage;
  parameterValues?: Record<string, unknown>;
  outKeyRefs: AbcProgramOutKeyRef[];
  sourceAnalysis?: import("./query-subgraph").QuerySubgraph;
  parameters?: AbcProgramParameter[];
};

export type LegacyInlineEntry = LegacyDashboardChartEntry | LegacyDashboardMetricEntry;
